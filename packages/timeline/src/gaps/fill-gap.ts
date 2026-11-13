// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.fillGap (P3-B8): a gap becomes a clip of the same length in the same place, keeping the gap's id and
 * slot and taking the beat anchor of its start. A still moves gently (its `stillMotion`); a video's in-point is
 * the caller's or the in-point rule's (command handler). The cast slot's pick becomes the new media with note
 * `gapFilled`. Images from generation (P3-B7) and stock (P3-V18) are library assets by now, so their origin
 * and licence live with the asset, not the clip.
 */
import {
  err,
  ok,
  RationalTime,
  type CastCandidate,
  type Clip,
  type Result,
  type StillMotion,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { replaceMedia, type Replacement } from '../edits/swap';
import type { EditResult } from '../edits/types';
import { GapNotFound, MediaTooShort, NotAGap } from '../errors';
import { manualCandidate, updateSlots, withPick } from '../model/cast';
import { findPosition, medianItemFrames, videoItems, withVideoItems, type Position } from '../model/sequence';
import { anchorAt, beatGrid } from '../resync/grid';

export type GapFill =
  | { readonly kind: 'image'; readonly assetId: Clip['media']['assetId']; readonly stillMotion: StillMotion }
  | { readonly kind: 'video'; readonly replacement: Replacement };

/** The gap at `gapId`, or why there isn't one. */
export function gapPosition(timeline: Timeline, gapId: TimelineItemId): Result<Position> {
  const position = findPosition(timeline, gapId);
  if (!position) return err(GapNotFound({ gapId }));
  if (position.item.type !== 'gap') return err(NotAGap({ itemId: gapId }));
  return ok(position);
}

export function fillGap(timeline: Timeline, gapId: TimelineItemId, fill: GapFill): Result<EditResult> {
  const found = gapPosition(timeline, gapId);
  if (!found.ok) return found;
  const { item: gap, start, itemIndex } = found.value;
  const rate = timeline.canvas.rate;
  const items = [...videoItems(timeline)];
  const grid = beatGrid(timeline.beatMap, rate, medianItemFrames(items));
  const base: Clip = {
    type: 'clip',
    id: gap.id,
    media: fill.kind === 'image' ? { kind: 'image', assetId: fill.assetId } : fill.replacement.media,
    sourceStart: RationalTime.zero(rate),
    duration: gap.duration,
    speed: null,
    slotId: gap.slotId,
    syncPoint: null,
    beatAnchor: anchorAt(grid, start, rate),
    fit: 'cover',
    audio: { gainDb: 0, muted: true },
    locked: false,
    enabled: true,
    stillMotion: fill.kind === 'image' ? fill.stillMotion : null,
    reframe: null,
  };
  let clip: Clip = base;
  let pick: CastCandidate = manualCandidate({ assetId: base.media.assetId, shotId: null }, base.sourceStart, null);
  if (fill.kind === 'video') {
    const placed = replaceMedia(base, fill.replacement, timeline);
    if (!placed) return err(MediaTooShort({ clipId: gap.id }));
    clip = placed;
    const shotId = placed.media.kind === 'video' ? placed.media.shotId : null;
    pick = fill.replacement.candidate ?? manualCandidate({ assetId: placed.media.assetId, shotId }, placed.sourceStart, placed.syncPoint);
  }
  items[itemIndex] = clip;
  const cast = updateSlots(timeline.cast, (slot) =>
    slot.slotId === gap.slotId
      ? { ...withPick(slot, pick, { confidence: null, needsRerank: false, note: 'gapFilled' }), clipId: clip.id }
      : slot,
  );
  return ok({ timeline: withVideoItems({ ...timeline, cast }, items), changed: ['tracks', 'cast'] });
}
