// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  FrameRate,
  MIX_COMMANDS,
  newId,
  RationalTime,
  type SequenceItem,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { trackOfRole } from '../../src/commands/audio-track';
import { timelineCuts, type TransitionKind } from '../../src/sfx/cuts';
import { hitSound, createSfxCommands } from '../../src/sfx/hits-command';
import { planHits } from '../../src/sfx/hit-plan';
import type { SfxPackItem } from '../../src/sfx/pack-catalogue';
import { busWith, memoryTimelineStore, UI } from '../helpers/bus';
import { makeTestTimeline, steadyBeatMap } from '../helpers/timeline';

const item = (
  id: string,
  category: SfxPackItem['category'],
  durationMs: number,
  peakMs: number,
): SfxPackItem => ({
  id,
  title: id,
  category,
  file: `${id}.opus`,
  durationMs,
  peakMs,
  loudnessLufs: -16,
  licence: 'CC0-1.0',
  source: 'https://example.org/cc0',
});
const PACK = [
  item('whoosh-a', 'whoosh', 800, 420),
  item('whoosh-b', 'whoosh', 700, 350),
  item('riser-a', 'riser', 1500, 1499),
  item('impact-a', 'impact', 900, 15),
  item('hit-a', 'hit', 300, 5),
];

/** Clips of `frames` at 30 fps (120 BPM grid: a downbeat every 2 s = 60 frames), with transitions between. */
function timeline(frames: readonly number[], transitions: readonly (TransitionKind | null)[]): Timeline {
  const tl = makeTestTimeline({
    rate: FrameRate.of(30),
    clips: frames.map((f) => ({ frames: f })),
    beatMap: steadyBeatMap(120, 30),
  });
  const video = tl.tracks[0];
  if (!video || video.kind !== 'video') throw new Error('no V1');
  const items: SequenceItem[] = [];
  video.items.forEach((clip, i) => {
    const kind = transitions[i - 1];
    if (i > 0 && kind)
      items.push({
        type: 'transition',
        id: newId<'TimelineItem'>(),
        kind,
        inOffset: RationalTime.of(5, tl.canvas.rate),
        outOffset: RationalTime.of(5, tl.canvas.rate),
        direction: null,
      });
    // Handles on both sides, so a transition has media to overlap.
    items.push(clip.type === 'clip' ? { ...clip, sourceStart: RationalTime.of(10, tl.canvas.rate) } : clip);
  });
  return { ...tl, tracks: [{ ...video, items }] };
}

describe('planHits (P3-V6)', () => {
  it('maps transitions to categories with the peak on the cut', () => {
    const tl = timeline([45, 45, 45, 45, 45, 45], ['whip', 'zoom', 'flash', 'dissolve', null]);
    const cuts = timelineCuts(tl);
    expect(cuts.map((c) => c.frame)).toEqual([45, 90, 135, 180, 225]);
    const hits = planHits({ cuts, items: PACK, timelineMs: 9000 });
    expect(hits.map((h) => [h.cutIndex, h.category])).toEqual([
      [0, 'whoosh'],
      [1, 'riser'],
      [1, 'impact'],
      [2, 'impact'],
    ]);
    const whoosh = hits[0];
    expect((whoosh?.startMs ?? 0) + (whoosh?.item.peakMs ?? 0)).toBeCloseTo(1500, 6);
    const riser = hits[1];
    const impact = hits[2];
    // The riser stops where the impact starts, so the track never overlaps.
    expect((riser?.startMs ?? 0) + (riser?.durationMs ?? 0)).toBeCloseTo(impact?.startMs ?? 0, 6);
    expect((impact?.startMs ?? 0) + 15).toBeCloseTo(3000, 6);
  });

  it('gives hard cuts a subtle hit on downbeats only, unless every cut is asked for', () => {
    const tl = timeline([60, 45, 75, 60], [null, null, null]);
    const cuts = timelineCuts(tl);
    expect(cuts.map((c) => c.onDownbeat)).toEqual([true, false, true]);
    expect(planHits({ cuts, items: PACK, timelineMs: 8000 }).map((h) => h.cutIndex)).toEqual([0, 2]);
    expect(
      planHits({ cuts, items: PACK, timelineMs: 8000, density: 'everyCut' }).map((h) => h.cutIndex),
    ).toEqual([0, 1, 2]);
    expect(
      planHits({ cuts, items: PACK, timelineMs: 8000, density: 'hookOnly' }).map((h) => h.cutIndex),
    ).toEqual([0]);
    const hit = planHits({ cuts, items: PACK, timelineMs: 8000 })[0];
    expect(hit?.gainDb).toBe(-18);
  });

  it('keeps 400 ms apart, alternates sounds and skips cuts inside spoken voiceover unless punchy', () => {
    const tl = timeline([30, 9, 30, 30, 30], ['whip', 'whip', 'whip', 'whip']);
    const cuts = timelineCuts(tl);
    const hits = planHits({ cuts, items: PACK, timelineMs: 4300 });
    expect(hits.map((h) => h.cutIndex)).toEqual([0, 2, 3]);
    expect(hits.map((h) => h.item.id)).toEqual(['whoosh-a', 'whoosh-b', 'whoosh-a']);
    const speech = [{ startMs: 1200, endMs: 2500 }];
    expect(planHits({ cuts, items: PACK, timelineMs: 4300, speech }).map((h) => h.cutIndex)).toEqual([0, 3]);
    expect(
      planHits({ cuts, items: PACK, timelineMs: 4300, speech, style: 'punchy' }).map((h) => h.cutIndex),
    ).toEqual([0, 2, 3]);
  });
});

describe('sfx.setHits', () => {
  it('lands the peak on the cut to the sample, replaces A3 and undoes', async () => {
    const tl = timeline([45, 45, 45], ['whip', null]);
    const at = RationalTime.of(1500 - 420, { num: 1000, den: 1 });
    const sound = hitSound(
      {
        id: newId<'TimelineItem'>(),
        at,
        assetId: newId<'Asset'>(),
        sourceStart: RationalTime.zero({ num: 1000, den: 1 }),
        duration: RationalTime.of(800, { num: 1000, den: 1 }),
        gainDb: -14,
        category: 'whoosh',
      },
      tl.canvas.rate,
    );
    // 1080 ms is frame 32.4: the clip starts on frame 33 and skips 20 ms into the sound.
    expect(sound.startFrame).toBe(33);
    expect(RationalTime.toSeconds(sound.sourceStart) * 1000).toBeCloseTo(20, 6);
    const peakAt = (sound.startFrame * 1000) / 30 - RationalTime.toSeconds(sound.sourceStart) * 1000 + 420;
    expect(peakAt).toBeCloseTo(1500, 6);

    const store = memoryTimelineStore(tl);
    const { bus } = busWith(store, (deps) => createSfxCommands(deps).all);
    const hits = planHits({ cuts: timelineCuts(tl), items: PACK, timelineMs: 4500 }).map((h) => ({
      id: newId<'TimelineItem'>(),
      at: RationalTime.of(Math.round(h.startMs), { num: 1000, den: 1 }),
      assetId: newId<'Asset'>(),
      sourceStart: RationalTime.of(h.sourceStartMs, { num: 1000, den: 1 }),
      duration: RationalTime.of(h.durationMs, { num: 1000, den: 1 }),
      gainDb: h.gainDb,
      category: h.category,
    }));
    const set = await bus.dispatch(
      MIX_COMMANDS.setHits,
      { projectId: tl.projectId, timelineId: tl.id, hits },
      UI,
    );
    expect(set.ok ? 'ok' : `${set.error.code} ${set.error.detail}`).toBe('ok');
    const track = trackOfRole(store.current(tl.id), 'sfx');
    expect(track?.id).toBe('A3');
    expect(track?.items.filter((i) => i.type === 'clip')).toHaveLength(hits.length);
    await bus.dispatch(MIX_COMMANDS.setHits, { projectId: tl.projectId, timelineId: tl.id, hits: [] }, UI);
    expect(trackOfRole(store.current(tl.id), 'sfx')).toBeNull();
    await bus.undo(tl.projectId, UI);
    expect(trackOfRole(store.current(tl.id), 'sfx')?.items.filter((i) => i.type === 'clip')).toHaveLength(
      hits.length,
    );
  });
});
