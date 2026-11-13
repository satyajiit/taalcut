// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One simulated creator over the app's casting and learning (LRN1-PREF eval). Rounds of videos: the agent casts and
 * assembles each (with whatever weights the learned item holds then), the creator swaps and removes through the
 * timeline commands, and the learning job runs after each round, as it would a few seconds after a burst. Then the
 * exam: templates the learner never saw, cast with casting.v1's defaults, where the creator's choice in every slot is
 * kept, to score the learned weights against the defaults and against the creator's own (ExamSlot, score.ts).
 */
import {
  MEMORY_COMMANDS,
  memoryCommandPayloads,
  TIMELINE_COMMANDS,
  unwrap,
  type AuditEntry,
  type CastingWeights,
} from '@taalcut/core';
import {
  CASTING_CONFIG,
  createCastingEngine,
  createMemoryShotCatalog,
  foldLog,
  LEARNER_CONFIG,
  LEARNER_ORIGIN,
  learnCastingWeights,
  weightsOfData,
  type LearnOutcome,
} from '@taalcut/timeline';
import { hashingEmbedder } from '../casting/library';
import { mulberry32 } from '../gates/stats';
import { openPrefApp, PERSON, type PrefApp, type Video } from './app';
import { decide, type Persona } from './creator';
import type { ExamSlot } from './score';
import { worldId, type PrefWorld } from './world';

export interface SimulationOptions {
  readonly rounds: number;
  readonly videosPerRound: number;
  readonly examTemplates: number;
}

export const SIMULATION_DEFAULTS: SimulationOptions = { rounds: 8, videosPerRound: 5, examTemplates: 24 };
/** Exam templates come from far past any training index, so the learner never saw one. */
const EXAM_OFFSET = 100_000;

export interface RoundResult {
  readonly round: number;
  /** Slots the creator looked at (one with a pick). */
  readonly slots: number;
  readonly swaps: number;
  readonly drops: number;
  /** The weights the round's videos were cast with. */
  readonly castWith: string;
  readonly outcome: LearnOutcome;
  readonly weights: CastingWeights;
  readonly pairs: number;
  readonly evidence: number;
}

export interface PersonaRun {
  readonly persona: Persona;
  readonly rounds: readonly RoundResult[];
  /** The learned item's weights at the end; casting.v1's when there is none. */
  readonly learned: CastingWeights;
  /** Every set of weights the learning job wrote, in order. */
  readonly writes: readonly CastingWeights[];
  /** The same log folded and learned again: equal to `learned` (the same log gives the same weights). */
  readonly relearned: CastingWeights;
  /** Commands the bus refused (a swap the media couldn't take); listed, never hidden. */
  readonly refused: readonly string[];
  readonly exam: readonly ExamSlot[];
  /** Every entry the run wrote, oldest first. */
  readonly log: readonly AuditEntry[];
}

/** A stream of its own per persona and purpose, so one persona's choices never shift another's. */
const streamFor = (seed: number, persona: number, purpose: number) =>
  mulberry32(seed * 1_000_003 + persona * 7_919 + purpose);

async function review(app: PrefApp, video: Video, who: Persona, random: () => number) {
  let slots = 0;
  let swaps = 0;
  let drops = 0;
  const refused: string[] = [];
  const target = { projectId: video.projectId, timelineId: video.timeline.id };
  for (const slot of video.timeline.cast?.slots ?? []) {
    if (!slot.pick || !slot.clipId) continue;
    slots += 1;
    const { decision } = decide(who, slot, random);
    if (decision.kind === 'keep') continue;
    const done =
      decision.kind === 'swap'
        ? await app.dispatch(
            TIMELINE_COMMANDS.swapClip,
            {
              ...target,
              clipId: slot.clipId,
              media: { assetId: decision.to.assetId, shotId: decision.to.shotId },
              sourceStart: decision.to.sourceStart,
              from: 'alternate',
              scored: { score: decision.to.score, parts: decision.to.parts },
            },
            PERSON,
          )
        : await app.dispatch(
            TIMELINE_COMMANDS.dropSlot,
            { ...target, itemId: slot.clipId, mode: 'ripple' },
            PERSON,
          );
    if (!done.ok) refused.push(`${decision.kind}: ${done.error.code}`);
    else if (decision.kind === 'swap') swaps += 1;
    else drops += 1;
  }
  return { slots, swaps, drops, refused };
}

/** The weights each learning-job write carried, from the log. */
function writesIn(log: readonly AuditEntry[]): CastingWeights[] {
  const ours = log.filter(
    (entry) =>
      entry.actor === LEARNER_ORIGIN.actor &&
      (entry.name === MEMORY_COMMANDS.create || entry.name === MEMORY_COMMANDS.update),
  );
  return ours.flatMap((entry) => {
    const created = memoryCommandPayloads[MEMORY_COMMANDS.create].safeParse(entry.payload);
    const updated = memoryCommandPayloads[MEMORY_COMMANDS.update].safeParse(entry.payload);
    const data = created.success ? created.data.item.data : updated.success ? updated.data.patch.data : null;
    const weights = weightsOfData(data ?? null, CASTING_CONFIG);
    return weights ? [weights] : [];
  });
}

/** The creator's choices on templates the learner never saw, cast with casting.v1's defaults. */
async function sitExam(
  world: PrefWorld,
  who: Persona,
  count: number,
  random: () => number,
): Promise<ExamSlot[]> {
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog([...world.profiles]),
    embedder: hashingEmbedder(),
  });
  const slots: ExamSlot[] = [];
  for (let index = 0; index < count; index++) {
    const template = world.template(EXAM_OFFSET + index);
    const cast = unwrap(
      await engine.cast({
        projectId: worldId<'Project'>(7, index),
        template,
        mode: 'template',
        variants: 1,
        seed: 1,
      }),
    );
    for (const slot of cast.variants[0]?.slots ?? []) {
      if (!slot.pick) continue;
      const choice = decide(who, slot, random);
      // A removal says what they don't want, not which shot they do.
      if (choice.decision.kind === 'drop') continue;
      slots.push({ shown: [slot.pick, ...slot.alternates], chosen: choice.chosen });
    }
  }
  return slots;
}

export async function runPersona(
  world: PrefWorld,
  who: Persona,
  index: number,
  options: SimulationOptions = SIMULATION_DEFAULTS,
): Promise<PersonaRun> {
  const app = openPrefApp(world);
  try {
    const random = streamFor(world.seed, index, 1);
    const rounds: RoundResult[] = [];
    const refused: string[] = [];
    let template = 0;
    for (let round = 1; round <= options.rounds; round++) {
      let slots = 0;
      let swaps = 0;
      let drops = 0;
      let castWith = '';
      for (let video = 0; video < options.videosPerRound; video++) {
        const made = await app.video(world.template(template), template);
        template += 1;
        castWith = made.cast.configVersion;
        const reviewed = await review(app, made, who, random);
        slots += reviewed.slots;
        swaps += reviewed.swaps;
        drops += reviewed.drops;
        refused.push(...reviewed.refused);
      }
      const run = unwrap(await app.learner.run());
      rounds.push({ round, slots, swaps, drops, castWith, ...run });
    }
    const log = await app.log();
    const folded = foldLog(log, CASTING_CONFIG, LEARNER_CONFIG);
    const relearned = learnCastingWeights({
      start: folded.start,
      defaults: CASTING_CONFIG.weights,
      pairs: folded.pairs,
      tau: CASTING_CONFIG.confidence.tau,
    }).weights;
    const writes = writesIn(log);
    const exam = await sitExam(world, who, options.examTemplates, streamFor(world.seed, index, 2));
    return {
      persona: who,
      rounds,
      learned: writes.at(-1) ?? CASTING_CONFIG.weights,
      writes,
      relearned,
      refused,
      exam,
      log,
    };
  } finally {
    app.close();
  }
}
