// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Beat re-sync (R14): the grid, snapping moved cuts, anchors, transitions, text, idempotence. */
import { FrameRate, FrameRates, RationalTime, type BeatMap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { trimClip } from '../src/edits/trim';
import { MARKER_LABELS } from '../src/model/markers';
import { anchorAt, beatGrid, gridPointsNear, isOnGrid } from '../src/resync/grid';
import { fitTransitions } from '../src/resync/neighbours';
import { resync, resyncToBeatMap } from '../src/resync/resync';
import { buildTimeline, clipById, starts } from './fixtures/timeline';

const rate = FrameRates.fps30;
const user = { source: 'ui' } as const;

function beatMap(every: number, count: number, mapRate: FrameRate = rate): BeatMap {
  return {
    rate: mapRate,
    beats: Array.from({ length: count }, (_, index) =>
      RationalTime.rescale(RationalTime.of(index * every, rate), mapRate, 'round'),
    ),
    downbeats: [0],
    bpm: 120,
    beatsPerBar: 4,
    confidence: 1,
    source: 'tracker',
  };
}

describe('the grid', () => {
  it('rescales beats to canvas frames and adds half beats only for short shots', () => {
    const map = beatMap(15, 5, FrameRate.of(1000));
    expect(beatGrid(map, rate, 30).points).toEqual([0, 15, 30, 45, 60]);
    expect(beatGrid(map, rate, 10).points).toEqual([0, 8, 15, 23, 30, 38, 45, 53, 60]);
    expect(beatGrid(map, rate, 30).interval).toBe(15);
  });

  it('is every frame without a beat map', () => {
    const grid = beatGrid(null, rate, 30);
    expect(grid.points).toBeNull();
    expect(isOnGrid(grid, 7)).toBe(true);
    expect(gridPointsNear(grid, 5, 4, 6)).toEqual([5, 4, 6]);
    expect(anchorAt(grid, 7, rate)).toBeNull();
  });

  it('anchors a frame to its nearest beat, ties going earlier', () => {
    const grid = beatGrid(beatMap(10, 4), rate, 30);
    expect(anchorAt(grid, 14, rate)).toEqual({ beatIndex: 1, offset: RationalTime.of(4, rate) });
    expect(anchorAt(grid, 15, rate)).toEqual({ beatIndex: 1, offset: RationalTime.of(5, rate) });
    expect(anchorAt(grid, 16, rate)?.beatIndex).toBe(2);
    expect(anchorAt(grid, 99, rate)?.beatIndex).toBe(3);
    expect(gridPointsNear(grid, 14, 0, 30)).toEqual([10, 20, 0, 30]);
  });
});

describe('resync', () => {
  it('changes nothing on a synced timeline (idempotent)', () => {
    const { timeline } = buildTimeline({
      clips: [{ frames: 30 }, { frames: 30, transition: ['dissolve', 5, 5] }, { frames: 45 }],
      texts: [{ start: 35, frames: 10, slot: 1 }],
    });
    expect(resync(timeline)).toEqual(timeline);
    expect(resync(resync(timeline, { moved: [1, 2, 3] }))).toEqual(resync(timeline, { moved: [1, 2, 3] }));
  });

  it('snaps a rolled cut to the nearest beat and moves the anchor with it', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
    const trimmed = trimClip(timeline, { clipId: ids[1]!, edge: 'end', by: RationalTime.of(10, rate) }, user);
    if (!trimmed.ok) throw new Error(trimmed.error.code);
    expect(starts(trimmed.value.timeline)).toEqual([0, 30, 75, 90]);
    const right = clipById(trimmed.value.timeline, ids[2]!);
    expect(right.beatAnchor).toEqual({ beatIndex: 5, offset: RationalTime.of(0, rate) });
    // The sync point stays on the new anchor: the clip starts at its peak again.
    expect(right.sourceStart).toEqual(RationalTime.of(100, rate));
    expect(trimmed.value.timeline.markers).toEqual([]);
  });

  it('snaps a rippled end and leaves every other cut where it was', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
    const trimmed = trimClip(timeline, { clipId: ids[2]!, edge: 'end', by: RationalTime.of(10, rate) }, user);
    if (!trimmed.ok) throw new Error(trimmed.error.code);
    expect(starts(trimmed.value.timeline)).toEqual([0, 30, 60, 105]);
  });

  it('leaves a cut with no grid point that fits on its frame, with an off-beat QA marker', () => {
    const { timeline, ids } = buildTimeline({
      clips: [
        { frames: 37, sourceStart: 0, media: 40 },
        { frames: 53, sourceStart: 0 },
      ],
    });
    const trimmed = trimClip(timeline, { clipId: ids[0]!, edge: 'end', by: RationalTime.of(3, rate) }, user);
    if (!trimmed.ok) throw new Error(trimmed.error.code);
    expect(starts(trimmed.value.timeline)).toEqual([0, 40, 90]);
    const [marker] = trimmed.value.timeline.markers;
    expect(marker?.kind).toBe('qa');
    expect(marker?.label).toBe(MARKER_LABELS.offBeat);
    expect(marker?.range.start.value).toBe(40);
    // Re-syncing again doesn't add a second marker.
    expect(resync(trimmed.value.timeline).markers).toHaveLength(1);
  });

  it('keeps both neighbours at least minClip long when it moves a cut', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
    const trimmed = trimClip(timeline, { clipId: ids[1]!, edge: 'end', by: RationalTime.of(25, rate) }, user);
    if (!trimmed.ok) throw new Error(trimmed.error.code);
    // 85 is nearest 90, which would leave the last clip with no frames; 75 keeps it at 15.
    expect(starts(trimmed.value.timeline)).toEqual([0, 30, 75, 90]);
  });

  it('re-times every cut to a new grid', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
    const retimed = resyncToBeatMap(timeline, beatMap(20, 10));
    expect(starts(retimed)).toEqual([0, 20, 60, 80]);
    expect(clipById(retimed, ids[1]!).beatAnchor).toEqual({ beatIndex: 1, offset: RationalTime.of(0, rate) });
    expect(clipById(retimed, ids[2]!).beatAnchor?.beatIndex).toBe(3);
    const cleared = resyncToBeatMap(timeline, null);
    expect(starts(cleared)).toEqual(starts(timeline));
    expect(clipById(cleared, ids[1]!).beatAnchor).toBeNull();
  });

  it('moves text tied to a slot with its clip and keeps it inside', () => {
    const { timeline, ids } = buildTimeline({
      clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }],
      texts: [{ start: 65, frames: 10, slot: 2 }, { start: 5, frames: 10 }],
    });
    const trimmed = trimClip(timeline, { clipId: ids[2]!, edge: 'start', by: RationalTime.of(15, rate) }, user);
    if (!trimmed.ok) throw new Error(trimmed.error.code);
    expect(starts(trimmed.value.timeline)).toEqual([0, 30, 45, 90]);
    const text = trimmed.value.timeline.tracks.find((track) => track.kind === 'text');
    const items = text?.kind === 'text' ? text.items : [];
    expect(items.map((item) => item.start.value)).toEqual([5, 50]);
  });
});

describe('transitions follow their cut', () => {
  it('shrink to the handles left and go when none is left or a neighbour is a gap', () => {
    const { timeline } = buildTimeline({
      clips: [{ frames: 30, sourceStart: 100 }, { frames: 30, sourceStart: 12, transition: ['dissolve', 10, 6] }],
    });
    const video = timeline.tracks[0];
    if (video?.kind !== 'video') throw new Error('no V1');
    const [first, transition, second] = video.items;
    if (second?.type !== 'clip' || transition?.type !== 'transition') throw new Error('fixture');
    const shrunk = fitTransitions([first!, transition, { ...second, sourceStart: RationalTime.of(4, rate) }], rate);
    expect(shrunk[1]).toMatchObject({ inOffset: RationalTime.of(4, rate), outOffset: RationalTime.of(6, rate) });
    const none = fitTransitions(
      [first!, { ...transition, outOffset: RationalTime.of(0, rate) }, { ...second, sourceStart: RationalTime.of(0, rate) }],
      rate,
    );
    expect(none.map((item) => item.type)).toEqual(['clip', 'clip']);
    const gap = fitTransitions([first!, transition, { type: 'gap', id: second.id, duration: second.duration, slotId: null }], rate);
    expect(gap.map((item) => item.type)).toEqual(['clip', 'gap']);
  });
});
