// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.trimClip (SPEC trim model, pending PO confirmation): between two
 * items a trim rolls (the cut moves, the neighbour gives or takes the frames,
 * nothing else moves); the timeline's first edge slips (in-point moves,
 * length stays); its last edge ripples (the video gets shorter or longer).
 * The moved cut then re-syncs.
 */
import { err, ok, RationalTime, type Clip, type Result, type Timeline, type TimelineItemId } from '@taalcut/core';
import { InvalidMove, MediaTooShort } from '../errors';
import { toMedia, trimEnd, trimStart } from '../model/clip-edit';
import { positions, videoItems, withVideoItems, type Filler } from '../model/sequence';
import { clipMediaFits, speedAt } from '../model/speed';
import { resync } from '../resync/resync';
import { clipPosition, refuseLocked, unchanged, type EditOptions, type EditResult } from './types';

export interface TrimInput {
  readonly clipId: TimelineItemId;
  readonly edge: 'start' | 'end';
  /** Signed, at the canvas rate: positive lengthens the clip at that edge. */
  readonly by: RationalTime;
}

function checked(item: Filler, timeline: Timeline): Result<Filler> {
  if (item.duration.value < 1) return err(InvalidMove(undefined, { detail: 'An item would last under a frame' }));
  if (item.type === 'clip' && !clipMediaFits(item, timeline.canvas.rate))
    return err(MediaTooShort({ clipId: item.id }));
  return ok(item);
}

function rollTooFar(giver: Filler, clip: Clip): Result<never> {
  const seconds = Math.round(RationalTime.toSeconds(giver.duration) * 100) / 100;
  const detail =
    giver.id === clip.id
      ? `The clip lasts ${seconds} s: shorten it by less than that.`
      : `This edge takes its frames from the ${giver.type === 'clip' ? 'clip' : 'gap'} next to it, which lasts ` +
        `${seconds} s: move the edge by less than that.`;
  return err(InvalidMove(undefined, { detail }));
}

function slip(timeline: Timeline, clip: Clip, by: number): Result<Clip> {
  if (clip.media.kind === 'image') return ok(clip);
  const speed = clip.speed ? speedAt(clip.speed, 0) : 1;
  const shift = toMedia(Math.round(by * speed), timeline.canvas.rate, clip.sourceStart.rate);
  // The in-point is set on purpose, so there is no motion peak promised on the beat any more.
  const slipped: Clip = { ...clip, sourceStart: RationalTime.subtract(clip.sourceStart, shift), syncPoint: null };
  return clipMediaFits(slipped, timeline.canvas.rate) ? ok(slipped) : err(MediaTooShort({ clipId: clip.id }));
}

export function trimClip(timeline: Timeline, input: TrimInput, options: EditOptions): Result<EditResult> {
  const rate = timeline.canvas.rate;
  const by = RationalTime.rescale(input.by, rate, 'round').value;
  const found = clipPosition(timeline, input.clipId, options.source);
  if (!found.ok) return found;
  if (by === 0) return unchanged(timeline);
  const items = [...videoItems(timeline)];
  const all = positions(items);
  const index = all.findIndex((position) => position.item.id === input.clipId);
  const clip = found.value.item;
  let moved: number[] = [];

  if (input.edge === 'start' && index === 0) {
    const slipped = slip(timeline, clip, by);
    if (!slipped.ok) return slipped;
    items[found.value.itemIndex] = slipped.value;
  } else if (input.edge === 'end' && index === all.length - 1) {
    const rippled = checked(trimEnd(clip, by, rate), timeline);
    if (!rippled.ok) return rippled;
    items[found.value.itemIndex] = rippled.value;
    moved = [all.length];
  } else {
    // A roll: the cut between `left` and `right` moves by `shift` frames.
    const cut = input.edge === 'start' ? index : index + 1;
    const shift = input.edge === 'start' ? -by : by;
    const left = all[cut - 1];
    const right = all[cut];
    if (!left || !right) return err(InvalidMove());
    for (const neighbour of [left.item, right.item]) {
      const allowed = refuseLocked(neighbour, options.source);
      if (!allowed.ok) return allowed;
    }
    // EDT1-OPS: a roll takes its frames from the neighbour; say how far the edge can go, in the tools' seconds.
    const giver = shift > 0 ? right.item : left.item;
    if (RationalTime.rescale(giver.duration, rate, 'round').value - Math.abs(shift) < 1) return rollTooFar(giver, clip);
    const newLeft = checked(trimEnd(left.item, shift, rate), timeline);
    if (!newLeft.ok) return newLeft;
    const newRight = checked(trimStart(right.item, shift, rate), timeline);
    if (!newRight.ok) return newRight;
    items[left.itemIndex] = newLeft.value;
    items[right.itemIndex] = newRight.value;
    moved = [cut];
  }

  const edited = withVideoItems(timeline, items);
  const synced = resync(edited, {
    moved,
    before: timeline,
    ...(options.config ? { config: options.config } : {}),
    ...(options.ids ? { ids: options.ids } : {}),
  });
  return ok({ timeline: synced, changed: ['tracks', 'markers'] });
}
