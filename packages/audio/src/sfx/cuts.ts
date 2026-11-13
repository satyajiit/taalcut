// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The cuts of a timeline's video track, with the transition on each and whether it falls on a downbeat. Pure. */
import { RationalTime, type Timeline, type TRANSITION_KINDS } from '@taalcut/core';
import { frameMs, videoItems } from '../timeline/span';

export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export interface Cut {
  readonly index: number;
  readonly frame: number;
  readonly ms: number;
  /** null: a hard cut. */
  readonly transition: TransitionKind | null;
  readonly onDownbeat: boolean;
}

export function timelineCuts(timeline: Timeline): Cut[] {
  const items = videoItems(timeline);
  const frame = frameMs(timeline);
  const downbeats = (timeline.beatMap?.downbeats ?? []).flatMap((i) => {
    const beat = timeline.beatMap?.beats[i];
    return beat ? [RationalTime.toSeconds(beat) * 1000] : [];
  });
  const cuts: Cut[] = [];
  let at = 0;
  let pending: TransitionKind | null = null;
  for (const [i, item] of items.entries()) {
    if (item.type === 'transition') {
      pending = item.kind;
      continue;
    }
    if (at > 0 && i > 0) {
      const ms = at * frame;
      cuts.push({
        index: cuts.length,
        frame: at,
        ms,
        transition: pending,
        onDownbeat: downbeats.some((d) => Math.abs(d - ms) <= frame),
      });
    }
    pending = null;
    at += item.duration.value;
  }
  return cuts;
}
