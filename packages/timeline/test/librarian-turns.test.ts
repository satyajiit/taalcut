// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-LIBRARIAN: the Librarian finishes when most slots are unsure. The owner's template had 13 slots; casting
 * filled 11 with footage of the other orientation (each under the confidence line, none with an alternate) and left
 * 2 open. The prompt asked for a vision look at every unsure slot's candidates, which no tool could name a frame
 * for, and the step ran out of turns after it had assembled the video.
 *
 * Now timeline.cast lists at most three unsure slots worth a rerank (the least confident that have an alternate),
 * each with its intent and what indexing saw in every candidate, so a rerank is a reading in the turn the cast
 * arrives; timeline.assemble answers each timeline's revision, so the handoff needs no read; and the Librarian has a
 * turn limit of its own. Model turns through the real tools, scripted as the prompt asks: the owner's shape, and a
 * library where most slots are unsure with alternates to choose from.
 */
import { newId, ok, type ShotProfile, type SkillContext, type Template } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createCastingEngine } from '../src/casting/engine';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { LIBRARIAN_PROMPT } from '../src/skills/prompts';
import { timelineSkillModule } from '../src/skills/skills';
import { RERANK_SLOTS } from '../src/tools/rerank-material';
import { agentWorldOver } from './fixtures/agent';
import { world, type World } from './fixtures/casting';
import { fakeEmbedder, makeProfile, near, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const SLOTS = 13;

/** The owner's library: 11 shots for 13 slots, all portrait phone clips, for a landscape reel's template. */
function ownerWorld(): World {
  const intents = Array.from({ length: SLOTS }, (_, index) => unitVector(9_001 + index));
  const portrait = buildTemplate({
    slots: intents.map((_, index) => ({
      frames: 30,
      text: `static shot ${index}`,
      motion: 'static' as const,
    })),
  });
  const template: Template = { ...portrait, canvas: { ...portrait.canvas, width: 1080, height: 608 } };
  const table = new Map(intents.map((vector, index) => [`static shot ${index}`, vector]));
  const profiles: ShotProfile[] = intents
    .slice(0, 11)
    .map((intent, index) =>
      makeProfile({ embedding: near(intent, 500 + index, 0.1), orientation: 'portrait' }),
    );
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog(profiles),
    embedder: fakeEmbedder(table),
  });
  return { template, profiles, acceptable: [], engine };
}

/** Indexing described every shot. */
const describedAll = async (shotIds: readonly string[]) =>
  ok(new Map(shotIds.map((id) => [id, `A street at dusk, shot ${id.slice(-4)}`])));

interface Turn {
  readonly tool: string;
  readonly input: unknown;
}

/**
 * The Librarian's turns as its prompt asks, through the real tools: cast, rerank each listed slot by reading
 * (this model puts the last candidate first), assemble, hand off what the assembly returned.
 */
async function librarianTurns(w: ReturnType<typeof agentWorldOver>) {
  const turns: Turn[] = [];
  const run = async (tool: string, input: Record<string, unknown>) => {
    turns.push({ tool, input });
    const result = await w.call(tool, input);
    if (!result.ok) throw new Error(`${tool}: ${result.error.code}`);
    return result.value as Record<string, unknown>;
  };
  const target = { projectId: w.projectId, template: { id: w.template.id } };
  const cast = await run('timeline.cast', target);
  const listed = (cast.rerank ?? []) as { slotId: string; candidates: { shotId: string }[] }[];
  const rerank = listed.map((slot) => ({
    slotId: slot.slotId,
    order: slot.candidates.map((c) => c.shotId).reverse(),
  }));
  const assembled = await run('timeline.assemble', { ...target, ...(rerank.length > 0 ? { rerank } : {}) });
  const handOff = {
    templateId: w.template.id,
    timelineIds: assembled.timelineIds,
    revisions: assembled.revisions,
    lowConfidenceSlots: assembled.lowConfidence,
    reranked: rerank.length,
  };
  turns.push({ tool: 'handOff', input: handOff });
  return { turns, cast, rerank, handOff };
}

function librarianOver(w: ReturnType<typeof agentWorldOver>) {
  const librarian = timelineSkillModule({ service: w.service, templates: w.templates }).skills[0]!;
  const context: SkillContext = {
    runId: newId<'AgentRun'>(),
    projectId: w.projectId,
    flowId: null,
    stepId: 'f1',
    signal: new AbortController().signal,
  };
  return { librarian, context };
}

/** Each slot's intent, by slot id. */
const intentsOf = (template: Template) =>
  new Map(template.slots.map((slot) => [slot.id as string, slot.intent]));

describe('the Librarian on most slots unsure (FIX-LIBRARIAN)', () => {
  it("the owner's shape: nothing to rerank, the handoff from the assembly, within its own turn limit", async () => {
    const w = agentWorldOver(ownerWorld(), { shotDescriptions: describedAll });
    const { librarian, context } = librarianOver(w);
    const { turns, cast, handOff } = await librarianTurns(w);
    const slots = (
      cast.variants as {
        slots: { needsRerank: boolean; note: string | null; alternates: unknown[] }[];
      }[]
    )[0]!.slots;
    // BRK1-MAKE: the portrait clips are cast for a portrait video, so none is relaxed, capped or unsure.
    expect(slots.filter((slot) => slot.note === 'orientationRelaxed')).toEqual([]);
    expect(slots.filter((slot) => slot.needsRerank)).toEqual([]);
    expect(slots.filter((slot) => slot.note === 'noCandidates')).toHaveLength(2);
    expect(slots.every((slot) => slot.alternates.length === 0)).toBe(true);
    // No unsure slot has an alternate, so there is nothing to rerank, and the cast says so.
    expect(cast.rerank).toEqual([]);
    const [made] = handOff.timelineIds as string[];
    expect(w.store.docs.get(made!)!.canvas).toMatchObject({ width: 1080, height: 1920 });
    const output = librarian.output.parse(handOff);
    expect(output).toMatchObject({ revisions: [1], lowConfidenceSlots: 0, reranked: 0 });
    expect(await librarian.verify!(output, context)).toEqual(ok({ verdict: 'pass' }));
    // Its own limit holds this path with the owner's detours around it (a plan update, the question, two tool
    // searches) and a check sent back once (assemble and hand off again), and still keeps its last turn spare.
    const limit = librarian.limits?.maxTurns ?? 0;
    expect(turns.length + 4 + 2).toBeLessThan(limit);
  });

  it('most slots unsure with alternates: three listed, the least sure first, each candidate described', async () => {
    const w = agentWorldOver(world({ slots: SLOTS, perSlot: 4, distractors: 0, seed: 17, noise: 0.02 }), {
      shotDescriptions: describedAll,
    });
    const { librarian, context } = librarianOver(w);
    const { cast, rerank, handOff } = await librarianTurns(w);
    const slots = (
      cast.variants as {
        slots: {
          slotId: string;
          shotId: string;
          confidence: number;
          needsRerank: boolean;
          alternates: string[];
        }[];
      }[]
    )[0]!.slots;
    const unsure = slots.filter((slot) => slot.needsRerank && slot.alternates.length > 0);
    expect(unsure.length).toBeGreaterThan(SLOTS / 2);
    const order = new Map(w.template.slots.map((slot, index) => [slot.id as string, index]));
    const leastSure = [...unsure]
      .sort((a, b) => a.confidence - b.confidence || order.get(a.slotId)! - order.get(b.slotId)!)
      .slice(0, RERANK_SLOTS);
    const intents = intentsOf(w.template);
    expect(cast.rerank).toEqual(
      leastSure.map((slot) => ({
        slotId: slot.slotId,
        intent: {
          text: intents.get(slot.slotId)!.text,
          shotType: intents.get(slot.slotId)!.shotType,
          motion: intents.get(slot.slotId)!.motion,
        },
        candidates: [slot.shotId, ...slot.alternates].map((shotId) => ({
          shotId,
          description: `A street at dusk, shot ${shotId.slice(-4)}`,
        })),
      })),
    );
    // The answer stays inline (under the tools' 8 KiB), so the model reads it in the turn it arrives.
    expect(JSON.stringify(cast).length).toBeLessThan(8 * 1024);
    // The assembly takes the model's order: each reranked slot's pick carries the rerank bonus, and no other does.
    const [timelineId] = handOff.timelineIds as string[];
    const stored = w.store.docs.get(timelineId!)!.cast!.slots;
    const reranked = new Set(rerank.map((slot) => slot.slotId));
    for (const slot of stored)
      expect(slot.pick?.parts.rerank != null, slot.slotId).toBe(reranked.has(slot.slotId));
    const output = librarian.output.parse(handOff);
    expect(output.reranked).toBe(RERANK_SLOTS);
    expect(await librarian.verify!(output, context)).toEqual(ok({ verdict: 'pass' }));
  });

  it('lists nothing to rerank without stored descriptions, nor for a story cast (it takes no rerank)', async () => {
    const unsure = () => world({ slots: SLOTS, perSlot: 4, distractors: 0, seed: 17, noise: 0.02 });
    const bare = agentWorldOver(unsure());
    const cast = await bare.call('timeline.cast', {
      projectId: bare.projectId,
      template: { id: bare.template.id },
    });
    expect(cast.ok && cast.value.rerank).toEqual([]);
    const w = agentWorldOver(unsure(), { shotDescriptions: describedAll });
    const story = await w.call('timeline.cast', {
      projectId: w.projectId,
      template: { id: w.template.id },
      mode: 'story',
    });
    if (!story.ok) throw new Error(story.error.code);
    const storySlots = (
      story.value.variants as { slots: { needsRerank: boolean; alternates: unknown[] }[] }[]
    )[0]!;
    expect(storySlots.slots.some((slot) => slot.needsRerank && slot.alternates.length > 0)).toBe(true);
    expect(story.value.rerank).toEqual([]);
  });

  it('asks for nothing it has no tool for: no vision look, no file paths', () => {
    expect(LIBRARIAN_PROMPT).not.toContain('vision.describeFrame');
    expect(LIBRARIAN_PROMPT).toContain("don't look for files, frames or other tools");
  });
});
