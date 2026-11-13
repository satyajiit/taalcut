// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.setTransition and timeline.removeTransition (EDT1-OPS, SPEC "EDT1-OPS: transitions"): the transition on
 * the cut at one edge of a V1 clip, between two clips. Its length is centred on the cut where both clips have the
 * media (handles), else leans to the side that has it, else shrinks to what there is: `timeline.media_too_short`
 * under two frames. Setting one where there is one keeps its id and changes it; no cut moves, so nothing re-syncs.
 * A direction only means something to whip, slide and zoom; the others store none.
 */
import {
  err,
  ok,
  RationalTime,
  type DIRECTIONS,
  type DrawnTransitionKind,
  type Result,
  type SequenceItem,
  type Timeline,
  type TimelineItemId,
  type TransitionItem,
} from '@taalcut/core';
import { InvalidMove, ItemNotFound, MediaTooShort } from '../errors';
import { findPosition, positions, videoItems, withVideoItems, type Position } from '../model/sequence';
import { handleAfter, handleBefore, handleFrames } from '../resync/neighbours';
import { refuseLocked, unchanged, type EditOptions, type EditResult } from './types';

type Direction = (typeof DIRECTIONS)[number];
type Edge = 'start' | 'end';

export interface TransitionInput {
  readonly clipId: TimelineItemId;
  readonly edge: Edge;
  readonly kind: DrawnTransitionKind;
  readonly direction: Direction | null;
  readonly duration?: RationalTime | undefined;
}

/** The two clips either side of the cut at `edge` of the clip, or why there is no such cut. */
function cutAt(timeline: Timeline, clipId: TimelineItemId, edge: Edge): Result<readonly [Position, Position]> {
  const position = findPosition(timeline, clipId);
  if (!position || position.item.type !== 'clip') return err(ItemNotFound({ itemId: clipId }));
  const all = positions(videoItems(timeline));
  const index = all.findIndex((entry) => entry.item.id === clipId);
  const [left, right] = edge === 'end' ? [all[index], all[index + 1]] : [all[index - 1], all[index]];
  if (!left || !right || left.item.type !== 'clip' || right.item.type !== 'clip')
    return err(
      InvalidMove(undefined, {
        detail:
          edge === 'end'
            ? 'No clip after this one: for the cut between it and the one before, give that earlier clip (edge "end"), or this clip with edge "start"'
            : 'No clip before this one: give the cut after it with edge "end"',
      }),
    );
  return ok([left, right]);
}

/** The transition item between two adjacent V1 positions, if any. */
function between(items: readonly SequenceItem[], left: Position): number | null {
  const index = left.itemIndex + 1;
  return items[index]?.type === 'transition' ? index : null;
}

/** Default lengths: half a second, a whip a quarter. */
function defaultFrames(kind: DrawnTransitionKind, rate: Timeline['canvas']['rate']): number {
  const seconds = kind === 'whip' ? 0.25 : 0.5;
  return Math.max(2, Math.round((seconds * rate.num) / rate.den));
}

/** [inOffset, outOffset]: half each side of the cut, leaning to the side with media, or null under two frames. */
function offsets(total: number, left: Position, right: Position, rate: Timeline['canvas']['rate']): [number, number] | null {
  if (left.item.type !== 'clip' || right.item.type !== 'clip') return null;
  const limit = (value: number | null, length: number) => Math.min(length, value ?? Number.POSITIVE_INFINITY);
  // Before the cut the incoming clip shows early (its media before its in-point); after it the outgoing runs late.
  const maxIn = limit(handleFrames(handleBefore(right.item), rate), left.end - left.start);
  const maxOut = limit(handleFrames(handleAfter(left.item), rate), right.end - right.start);
  let inFrames = Math.min(Math.floor(total / 2), maxIn);
  const outFrames = Math.min(total - inFrames, maxOut);
  inFrames = Math.min(total - outFrames, maxIn);
  return inFrames + outFrames < 2 ? null : [inFrames, outFrames];
}

const directionFor = (kind: DrawnTransitionKind, direction: Direction | null): Direction | null =>
  kind === 'whip' || kind === 'slide' || kind === 'zoom' ? direction : null;

export function setTransition(
  timeline: Timeline,
  input: TransitionInput,
  options: EditOptions & { readonly ids: () => TimelineItemId },
): Result<EditResult & { readonly itemId: TimelineItemId }> {
  const rate = timeline.canvas.rate;
  const cut = cutAt(timeline, input.clipId, input.edge);
  if (!cut.ok) return cut;
  const [left, right] = cut.value;
  for (const side of [left, right]) {
    const allowed = refuseLocked(side.item, options.source);
    if (!allowed.ok) return allowed;
  }
  const total = input.duration
    ? RationalTime.rescale(input.duration, rate, 'round').value
    : defaultFrames(input.kind, rate);
  const fitted = offsets(Math.max(2, total), left, right, rate);
  if (!fitted) return err(MediaTooShort({ clipId: right.item.id }));
  const items = [...videoItems(timeline)];
  const existing = between(items, left);
  const old = existing === null ? null : (items[existing] as TransitionItem);
  const transition: TransitionItem = {
    type: 'transition',
    id: old?.id ?? options.ids(),
    kind: input.kind,
    inOffset: RationalTime.of(fitted[0], rate),
    outOffset: RationalTime.of(fitted[1], rate),
    direction: directionFor(input.kind, input.direction),
  };
  if (existing === null) items.splice(left.itemIndex + 1, 0, transition);
  else items[existing] = transition;
  if (old && JSON.stringify(old) === JSON.stringify(transition))
    return ok({ timeline, changed: [], itemId: transition.id });
  return ok({ timeline: withVideoItems(timeline, items), changed: ['tracks'], itemId: transition.id });
}

export function removeTransition(
  timeline: Timeline,
  input: { readonly transitionId?: TimelineItemId | undefined; readonly clipId?: TimelineItemId | undefined; readonly edge: Edge },
  options: EditOptions,
): Result<EditResult> {
  const items = [...videoItems(timeline)];
  let index: number | null;
  if (input.transitionId !== undefined) {
    index = items.findIndex((item) => item.id === input.transitionId && item.type === 'transition');
    if (index < 0) return err(ItemNotFound({ itemId: input.transitionId }));
  } else {
    const cut = cutAt(timeline, input.clipId as TimelineItemId, input.edge);
    if (!cut.ok) return cut.error.code === 'timeline.invalid_move' ? unchanged(timeline) : cut;
    index = between(items, cut.value[0]);
    if (index === null) return unchanged(timeline);
    for (const side of cut.value) {
      const allowed = refuseLocked(side.item, options.source);
      if (!allowed.ok) return allowed;
    }
  }
  items.splice(index, 1);
  return ok({ timeline: withVideoItems(timeline, items), changed: ['tracks'] });
}
