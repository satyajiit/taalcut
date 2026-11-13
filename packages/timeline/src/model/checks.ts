// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Read-only checks over a timeline, shared by tests, the Editor's verify and the tools. */
import type { Timeline } from '@taalcut/core';
import { anchorFrame, beatGrid } from '../resync/grid';
import { medianItemFrames, positions, videoItems } from './sequence';

export interface OffBeatCut {
  readonly clipId: string;
  /** Where the clip starts and where its anchor lands, in canvas frames. */
  readonly cut: number;
  readonly anchor: number;
}

/** Clips whose start is more than `tolerance` frames from their beat anchor (golden check: 1). */
export function cutsOffAnchor(timeline: Timeline, tolerance = 1): OffBeatCut[] {
  const items = videoItems(timeline);
  const grid = beatGrid(timeline.beatMap, timeline.canvas.rate, medianItemFrames(items));
  return positions(items).flatMap(({ item, start }) => {
    if (item.type !== 'clip' || !item.beatAnchor) return [];
    const anchor = anchorFrame(grid, item.beatAnchor);
    if (anchor === null || Math.abs(anchor - start) <= tolerance) return [];
    return [{ clipId: item.id, cut: start, anchor }];
  });
}

/** Summary numbers the cards and tools show. */
export function timelineStats(timeline: Timeline): { readonly frames: number; readonly clipCount: number } {
  const all = positions(videoItems(timeline));
  return {
    frames: all.at(-1)?.end ?? 0,
    clipCount: all.filter((position) => position.item.type === 'clip').length,
  };
}
