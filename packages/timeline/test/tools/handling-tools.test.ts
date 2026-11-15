// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM2: what the timeline tools say of a stretch where the camera is being handled (SPEC, "MOM2: handling
 * stretches"). Wherever a shot's moments are put in words the stretch is marked; a shot that is one such stretch
 * says so; a part the model states inside one is not used, and `timeline.cast` and `timeline.assemble` answer
 * `handling` with where the clip plays instead; `timeline.get` marks what a clip plays.
 */
import { ok, RationalTime, type Clip, type ShotProfile } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { createCastingEngine } from '../../src/casting/engine';
import { videoItems } from '../../src/model/sequence';
import { LIBRARIAN_PROMPT } from '../../src/skills/prompts';
import { partOutcome } from '../../src/tools/cast-answer';
import { momentsLine, partLines } from '../../src/tools/shot-moments';
import { agentWorldOver } from '../fixtures/agent';
import { world, type World } from '../fixtures/casting';
import { fakeEmbedder, makeProfile, unitVector } from '../fixtures/library';
import { withMoments } from '../fixtures/moments';

const SEED = 17;
const SLOTS = 13;

/** Every shot held for its first half, the camera lowered over its second (notes not embedded). */
const loweredAtTheEnd = (profile: ShotProfile): ShotProfile => {
  const length = profile.range.duration.value;
  const id = (profile.shotId ?? '').slice(-4);
  return withMoments(profile, [
    { to: Math.floor(length / 2), note: `Hands hold up tickets, shot ${id}.`, fit: null },
    { to: length, note: `The floor of the hall, shot ${id}.`, fit: null, handling: true },
  ]);
};

function handlingWorld(): World {
  const base = world({ slots: SLOTS, perSlot: 4, distractors: 0, seed: SEED, noise: 0.02 });
  const profiles = base.profiles.map(loweredAtTheEnd);
  const table = new Map(
    base.template.slots.map((_, index) => [`intent ${SEED}-${index}`, unitVector(SEED * 1000 + index)]),
  );
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog(profiles),
    embedder: fakeEmbedder(table),
  });
  return { ...base, profiles, engine };
}

const describedAll = async (shotIds: readonly string[]) =>
  ok(new Map(shotIds.map((id) => [id, `A hall, shot ${id.slice(-4)}`])));

interface SlotRow {
  readonly slotId: string;
  readonly shotId: string;
  readonly playsShotFrom?: number;
  readonly part?: string;
}

describe('a handling stretch in words', () => {
  const shot = withMoments(makeProfile({ embedding: unitVector(1), frames: 300, offset: 60 }), [
    { to: 240, note: 'Hands hold up tickets.', fit: null },
    { to: 300, note: 'The floor, with suitcases.', fit: null, handling: true },
  ]);

  it('is marked after its times, in a few characters', () => {
    expect(momentsLine(shot)).toBe(
      '2-10s: Hands hold up tickets.; 10-12s (camera handling): The floor, with suitcases.',
    );
    expect(partLines(shot, 10.5, 1)).toEqual({
      plays: '10-12s (camera handling): The floor, with suitcases.',
      rest: '2-10s: Hands hold up tickets.',
    });
  });

  it('is shown for a shot that is one such stretch, whose sentence does not say so', () => {
    const whole = withMoments(makeProfile({ embedding: unitVector(2), frames: 300 }), [
      { to: 300, note: 'A hand over the lens.', fit: null, handling: true },
    ]);
    expect(momentsLine(whole)).toBe('0-10s (camera handling): A hand over the lens.');
    expect(partLines(whole, 1, 1)).toEqual({
      plays: '0-10s (camera handling): A hand over the lens.',
      rest: null,
    });
  });

  it('reads a part set aside for it as handling, never a part that was kept', () => {
    expect(partOutcome({ from: 4, to: 6 }, 1, 1, true)).toBe('handling');
    expect(partOutcome({ from: 4, to: 6 }, 1, 1)).toBe('widened');
    expect(partOutcome({ from: 4, to: 6 }, 4.5, 1, true)).toBe('kept');
  });
});

describe('timeline.cast and timeline.assemble with handling stretches', () => {
  const target = (w: { projectId: string; template: { id: string } }) => ({
    projectId: w.projectId,
    template: { id: w.template.id },
  });

  it('do not use a part stated inside one, and say where the clip plays instead', async () => {
    const w = agentWorldOver(handlingWorld(), { shotDescriptions: describedAll });
    const first = await w.call('timeline.cast', target(w));
    if (!first.ok) throw new Error(first.error.code);
    // The rerank lists mark the stretch for the model that reads them.
    const listed = first.value.rerank as { candidates: { description: string }[] }[];
    for (const slot of listed)
      for (const candidate of slot.candidates)
        expect(candidate.description).toContain('s (camera handling): ');
    const rows = (first.value.variants as { slots: SlotRow[] }[])[0]!.slots;
    const [a, b] = rows as [SlotRow, SlotRow];
    const lengthOf = (shotId: string) =>
      RationalTime.toSeconds(w.profiles.find((profile) => profile.shotId === shotId)!.range.duration);
    const parts = [
      // The last second of the first slot's shot, in its lowering; the first second of the second's, held.
      { slotId: a.slotId, shotId: a.shotId, from: lengthOf(a.shotId) - 1, to: lengthOf(a.shotId) },
      { slotId: b.slotId, shotId: b.shotId, from: 0, to: 1.2 },
    ];
    const cast = await w.call('timeline.cast', { ...target(w), parts });
    if (!cast.ok) throw new Error(cast.error.code);
    const stated = (cast.value.variants as { slots: SlotRow[] }[])[0]!.slots;
    expect(stated[0]).toMatchObject({ shotId: a.shotId, part: 'handling' });
    expect(stated[0]!.playsShotFrom! + 1).toBeLessThanOrEqual(lengthOf(a.shotId) / 2 + 0.01);
    expect(stated[1]).toMatchObject({ shotId: b.shotId, part: 'kept' });

    const assembled = await w.call('timeline.assemble', { ...target(w), parts });
    if (!assembled.ok) throw new Error(assembled.error.code);
    const [timelineId] = assembled.value.timelineIds as string[];
    const answered = assembled.value.parts as { slotId: string; playsShotFrom: number; part: string }[];
    expect(answered.map((part) => part.part)).toEqual(['handling', 'kept']);
    // No clip of the video rests on its shot's lowering.
    const clips = videoItems(w.store.docs.get(timelineId!)!).filter(
      (item): item is Clip => item.type === 'clip',
    );
    expect(clips).toHaveLength(SLOTS);
    for (const clip of clips) {
      if (clip.media.kind !== 'video') continue;
      const half = lengthOf(clip.media.shotId as string) / 2;
      expect(RationalTime.toSeconds(clip.sourceStart) + 1).toBeLessThanOrEqual(half + 0.15 + 0.01);
    }
    // timeline.get says what each clip plays: none says it plays the marked stretch, each shows it in the rest.
    const read = await w.call('timeline.get', { timelineId });
    if (!read.ok) throw new Error(read.error.code);
    for (const clip of read.value.clips as { shows: string }[]) {
      const [, plays, rest] = clip.shows.split(' | ');
      expect(plays).toMatch(/^plays [\d.]+-[\d.]+s: Hands hold up tickets/);
      expect(rest).toMatch(/^rest of the shot [\d.]+-[\d.]+s \(camera handling\): The floor of the hall/);
    }
  });
});

describe('what the tools and the Librarian are told about handling stretches', () => {
  it('names the mark where a model reads moments', () => {
    const w = agentWorldOver(handlingWorld(), { shotDescriptions: describedAll });
    const description = (name: string) => w.tools.tools.find((tool) => tool.name === name)!.description;
    // timeline.get says what the mark is; the Librarian's prompt says it for the cast (its window has no room for
    // the same words in two tool descriptions: the desktop's agent-prompt-budget test).
    expect(description('timeline.get')).toContain('camera handling marks a stretch that is not footage');
    expect(LIBRARIAN_PROMPT).toContain('A stretch marked (camera handling) is not footage');
    expect(LIBRARIAN_PROMPT).toContain('and state no part inside one');
    expect(LIBRARIAN_PROMPT).toContain('or not used (handling)');
  });
});
