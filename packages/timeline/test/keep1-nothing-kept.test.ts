// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: a template with nothing kept behaves exactly as before. The same template and library are cast and
 * assembled by the tools with the reel source wired and without it: the answers and the stored timelines are the
 * same shot for shot, the reel source is never asked, and no answer mentions a reel slot. A template whose slots say
 * `footage: person` (the person chose "Use my clip") is the same as one that says nothing.
 */
import { templateSchema, type Template, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { memoryTemplateReader } from '../src/service/templates';
import { agentWorldOver } from './fixtures/agent';
import { world } from './fixtures/casting';
import { reelSource } from './fixtures/reel';

/** A timeline without what differs between two assemblies of one cast: its ids and the cast's id. */
function shape(timeline: Timeline) {
  const ids = new Map<string, string>();
  const name = (id: string | null) =>
    id === null ? null : (ids.get(id) ?? ids.set(id, `#${ids.size}`).get(id)!);
  return {
    canvas: timeline.canvas,
    music: timeline.music,
    tracks: timeline.tracks.map((track) => ({
      kind: track.kind,
      items: track.items.map((item) => {
        const { id, ...rest } = item as typeof item & { id: string };
        return { id: name(id), ...rest };
      }),
    })),
    markers: timeline.markers.map(({ id: _id, ...rest }) => rest),
    cast: timeline.cast!.slots.map((slot) => ({ ...slot, clipId: name(slot.clipId) })),
    confidence: timeline.cast!.sequenceConfidence,
  };
}

async function run(template: Template, base: ReturnType<typeof world>, wired: boolean) {
  const reel = reelSource();
  const w = agentWorldOver(
    { ...base, template },
    {
      templates: memoryTemplateReader([template], []),
      ...(wired ? { reel: reel.source } : {}),
    },
  );
  const target = { projectId: w.projectId, template: { id: template.id }, variants: 2, seed: 7 };
  const cast = await w.call('timeline.cast', target);
  if (!cast.ok) throw new Error(cast.error.code);
  const assembled = await w.call('timeline.assemble', target);
  if (!assembled.ok) throw new Error(assembled.error.code);
  const timelines = (assembled.value.timelineIds as string[]).map((id) => w.store.docs.get(id)!);
  const { castId: _a, artifact: _b, ...answer } = cast.value;
  const { castId: _c, timelineIds: _d, ...made } = assembled.value;
  return { answer, made, shapes: timelines.map(shape), calls: reel.calls };
}

describe('a template with nothing kept (KEEP1)', () => {
  const base = world({
    slots: 5,
    perSlot: 4,
    distractors: 12,
    seed: 23,
    overlays: [
      { start: 5, frames: 40, text: 'One', slot: 0 },
      { start: 70, frames: 40, text: 'Two', slot: 2 },
    ],
  });

  it('casts and assembles the same with the reel source wired as without it, and never asks it', async () => {
    const without = await run(base.template, base, false);
    const wired = await run(base.template, base, true);
    expect(wired.answer).toEqual(without.answer);
    expect(wired.made).toEqual(without.made);
    expect(wired.shapes).toEqual(without.shapes);
    expect(wired.calls).toEqual([]);
    expect(wired.made).not.toHaveProperty('reelSlots');
    expect(wired.answer).not.toHaveProperty('reelKept');
    const notes = wired.shapes.flatMap((timeline) => timeline.cast.map((slot) => slot.note));
    expect(notes).not.toContain('reelKept');
    expect(
      wired.shapes.flatMap((timeline) => timeline.tracks[0]!.items).some((item) => item.type === 'gap'),
    ).toBe(false);
  });

  it('treats “Use my clip” on every slot as saying nothing', async () => {
    const stated = templateSchema.parse({
      ...base.template,
      slots: base.template.slots.map((slot) => ({
        ...slot,
        footage: { from: 'person', by: 'user', reason: 'A film scene the joke lands on' },
      })),
    });
    const plain = await run(base.template, base, true);
    const mine = await run(stated, base, true);
    expect(mine.shapes).toEqual(plain.shapes);
    expect(mine.calls).toEqual([]);
  });
});
