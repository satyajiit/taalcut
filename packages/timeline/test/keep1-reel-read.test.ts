// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: what the models read about a slot that keeps the reel's footage, and the edges of casting it. timeline.get
 * marks the clip (`slot.keepsReel`, with no cast score: it was never scored); story order leaves the slot to the
 * reel as template order does; a hook variant re-casts the person's slots only; and a template whose every slot is
 * the reel's has nothing to cast.
 */
import { templateSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { hasReelSlots, personRerank } from '../src/casting/reel-slots';
import { agentWorldOver } from './fixtures/agent';
import { FILM_REASON, reelSource, reelWorld } from './fixtures/reel';

type Row = { kind: string; slot?: { slot: number; keepsReel?: true; cast?: unknown } };

describe('reading a slot that keeps the reel’s footage (KEEP1)', () => {
  it('timeline.get marks the reel’s clips and gives them no cast score', async () => {
    const cast = reelWorld({ kept: [1, 2] });
    const w = agentWorldOver(cast, { keptAudio: true, reel: reelSource().source });
    const made = await w.call('timeline.assemble', {
      projectId: w.projectId,
      template: { id: cast.template.id },
    });
    if (!made.ok) throw new Error(made.error.code);
    const read = await w.call('timeline.get', { timelineId: (made.value.timelineIds as string[])[0] });
    if (!read.ok) throw new Error(read.error.code);
    const rows = read.value.clips as Row[];
    expect(
      rows.map((row) => [row.slot?.slot, row.slot?.keepsReel ?? false, row.slot?.cast !== undefined]),
    ).toEqual([
      [1, false, true],
      [2, true, false],
      [3, true, false],
    ]);
  });

  it('story order leaves the slot to the reel too', async () => {
    const cast = reelWorld({ kept: [1], clips: 4 });
    const reel = reelSource();
    const w = agentWorldOver(cast, { keptAudio: true, reel: reel.source });
    const target = { projectId: w.projectId, template: { id: cast.template.id }, mode: 'story' };
    const read = await w.call('timeline.cast', target);
    if (!read.ok) throw new Error(read.error.code);
    const rows = (read.value.variants as { slots: { note: string | null; assetId: string | null }[] }[])[0]!
      .slots;
    expect(rows.map((row) => row.note)).toEqual([null, 'reelKept', null]);
    expect(rows[1]!.assetId).toBeNull();
    const made = await w.call('timeline.assemble', target);
    if (!made.ok) throw new Error(made.error.code);
    const timeline = w.store.docs.get((made.value.timelineIds as string[])[0]!)!;
    const video = timeline.tracks.flatMap((track) => (track.kind === 'video' ? track.items : []));
    expect(
      video.map((item) => (item.type === 'clip' ? item.media.assetId === reel.assetId : item.type)),
    ).toEqual([false, true, false]);
  });

  it('a hook variant re-casts the person’s slot and leaves the reel’s clips where they are', async () => {
    const cast = reelWorld({ kept: [1, 2], clips: 4 });
    const reel = reelSource();
    const w = agentWorldOver(cast, { keptAudio: true, reel: reel.source });
    const made = await w.call('timeline.assemble', {
      projectId: w.projectId,
      template: { id: cast.template.id },
    });
    if (!made.ok) throw new Error(made.error.code);
    const baseTimelineId = (made.value.timelineIds as string[])[0]!;
    const varied = await w.call('timeline.makeVariants', {
      projectId: w.projectId,
      baseTimelineId,
      count: 2,
      axes: ['hook'],
    });
    if (!varied.ok) throw new Error(varied.error.code);
    const variants = varied.value.timelineIds as string[];
    expect(variants.length).toBeGreaterThan(0);
    for (const id of [baseTimelineId, ...variants]) {
      const video = w.store.docs
        .get(id)!
        .tracks.flatMap((track) => (track.kind === 'video' ? track.items : []));
      const reelClips = video.flatMap((item) =>
        item.type === 'clip' && item.media.assetId === reel.assetId
          ? [[item.sourceStart.value, item.duration.value]]
          : [],
      );
      expect(reelClips).toEqual([
        [324, 129],
        [453, 14],
      ]);
    }
  });

  it('has nothing to cast when every slot is the reel’s (the template tools refuse to store such a template)', async () => {
    const cast = reelWorld({ kept: [] });
    const all = templateSchema.parse({
      ...cast.template,
      slots: cast.template.slots.map((slot) => ({
        ...slot,
        footage: { from: 'reel', by: 'analyst', reason: FILM_REASON },
      })),
    });
    const result = await cast.engine.cast({
      projectId: 'p' as never,
      template: all,
      mode: 'template',
      variants: 1,
      seed: 1,
    });
    expect(!result.ok && result.error.code).toBe('timeline.no_candidates');
  });

  it('drops a rerank that names a reel slot, and leaves a request with none as it was', () => {
    const cast = reelWorld({ kept: [1] });
    const [first, film] = cast.template.slots;
    const rerank = [
      { slotId: first!.id, order: ['a'] },
      { slotId: film!.id, order: ['b'] },
    ];
    expect(personRerank({ template: cast.template, rerank }).rerank).toEqual([rerank[0]]);
    const plain = { template: reelWorld({ kept: [] }).template, rerank };
    expect(personRerank(plain)).toBe(plain);
    expect(hasReelSlots(cast.template)).toBe(true);
    expect(hasReelSlots(plain.template)).toBe(false);
  });
});
