// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-OPS: what a case picked, as an edit target on the video (a selection's, or FIX-CMT's comment's anchor). */
import { RationalTime, type Timeline } from '@taalcut/core';
import type { Pick } from './case-types';
import { FPS } from './footage';
import { fixedId } from './ids';
import { IDS } from './timeline-doc';

export const seconds = (value: number) => RationalTime.of(Math.round(value * 30), FPS);

export function targetOf(pick: Pick, timeline: Timeline) {
  const item = (itemId: string, itemKind: string) => ({ kind: 'item', timelineId: timeline.id, itemId, itemKind });
  if ('clip' in pick) return item(IDS.clips[pick.clip]!, 'clip');
  if ('text' in pick) return item(pick.text === 'title' ? IDS.title : IDS.caption, 'text');
  if ('cue' in pick) return item(timeline.captions!.cues[pick.cue]!.id, 'caption');
  if ('graphic' in pick) return item(fixedId('01K8EG', 1), 'graphic');
  if ('voice' in pick) return item(IDS.voice, 'audio');
  const [from, to] = pick.range;
  return { kind: 'range', timelineId: timeline.id, range: { start: seconds(from), duration: seconds(to - from) } };
}
