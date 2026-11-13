// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.swapClip and timeline.applyCast: new media in the same place for
 * the same length, keeping the clip's id; the cast slot's pick becomes the new
 * shot and the old pick joins the alternates. The command handler resolves
 * the media (and the in-point) first, so these stay pure.
 */
import {
  err,
  ok,
  RationalTime,
  type CastCandidate,
  type Clip,
  type CommandSource,
  type MediaRef,
  type Result,
  type SlotCast,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { ItemNotFound, MediaMissing, MediaTooShort } from '../errors';
import { candidateKey, manualCandidate, marginConfidence, updateSlots, withPick } from '../model/cast';
import { positions, videoItems, withVideoItems } from '../model/sequence';
import { clipMediaFits, gentlerRamp } from '../model/speed';
import { anchorAt, beatGrid } from '../resync/grid';
import { resync } from '../resync/resync';
import { clipPosition, type EditOptions, type EditResult } from './types';

/** What replaces a clip's media, resolved by the caller. */
export interface Replacement {
  readonly media: MediaRef;
  readonly sourceStart: RationalTime;
  readonly syncPoint: RationalTime | null;
  /** The scored candidate when it came from casting or the alternates; null for a manual pick. */
  readonly candidate: CastCandidate | null;
}

export interface SwapInput {
  readonly clipId: TimelineItemId;
  readonly from: 'alternate' | 'search' | 'agent';
}

/** The clip with new media; a ramp the media can't carry gets gentler; null when the media is too short. */
export function replaceMedia(clip: Clip, replacement: Replacement, timeline: Timeline): Clip | null {
  const next: Clip = {
    ...clip,
    media: replacement.media,
    sourceStart:
      replacement.media.kind === 'image' ? RationalTime.zero(clip.sourceStart.rate) : replacement.sourceStart,
    syncPoint: replacement.media.kind === 'image' ? null : replacement.syncPoint,
  };
  if (clipMediaFits(next, timeline.canvas.rate)) return next;
  if (next.media.kind === 'image' || !next.speed) return null;
  const speed = gentlerRamp(next, next.media.available, timeline.canvas.rate);
  const gentler = { ...next, speed };
  return clipMediaFits(gentler, timeline.canvas.rate) ? gentler : null;
}

function noteFor(source: CommandSource): SlotCast['note'] {
  return source === 'agent' ? null : 'userPick';
}

export function swapClip(
  timeline: Timeline,
  input: SwapInput,
  replacement: Replacement,
  options: EditOptions,
): Result<EditResult> {
  const found = clipPosition(timeline, input.clipId, options.source);
  if (!found.ok) return found;
  const next = replaceMedia(found.value.item, replacement, timeline);
  if (!next) return err(MediaTooShort({ clipId: input.clipId }));
  const items = [...videoItems(timeline)];
  items[found.value.itemIndex] = next;
  const shotId = replacement.media.kind === 'video' ? replacement.media.shotId : null;
  const pick =
    replacement.candidate ??
    manualCandidate({ assetId: replacement.media.assetId, shotId }, next.sourceStart, next.syncPoint);
  const cast = updateSlots(timeline.cast, (slot) =>
    slot.clipId === input.clipId
      ? withPick(slot, pick, { confidence: null, needsRerank: false, note: noteFor(options.source) })
      : slot,
  );
  const edited = withVideoItems({ ...timeline, cast }, items);
  const synced = resync(edited, { before: timeline, ...(options.config ? { config: options.config } : {}) });
  return ok({ timeline: synced, changed: ['tracks', 'markers', 'cast'] });
}

export interface ApplyCastOptions extends EditOptions {
  /** Media by candidate key (shot id, or `asset:<id>` for a photo). */
  readonly media: ReadonlyMap<string, MediaRef>;
  /** Confidence squash, the casting config's `confidence.tau`. */
  readonly tau: number;
  /** What a pick's fit allows its confidence to be, as casting caps it (castingFitCap); absent, no cap. */
  readonly fitCap?: (pick: CastCandidate) => number;
}

/**
 * Swaps every listed slot in one step. Slots whose clip is locked, or that the user changed since
 * (`note: 'userPick'`), are skipped. An empty slot (a gap) becomes a clip with the gap's id.
 */
export function applyCast(
  timeline: Timeline,
  picks: readonly { readonly slotId: string; readonly pick: CastCandidate }[],
  options: ApplyCastOptions,
): Result<EditResult> {
  if (!timeline.cast) return err(ItemNotFound({ itemId: picks[0]?.slotId ?? 'cast' }));
  const rate = timeline.canvas.rate;
  const items = [...videoItems(timeline)];
  const grid = beatGrid(timeline.beatMap, rate, 0);
  const slots = new Map(timeline.cast.slots.map((slot) => [slot.slotId as string, slot]));
  for (const { slotId, pick } of picks) {
    const slot = slots.get(slotId);
    if (!slot) return err(ItemNotFound({ itemId: slotId }));
    if (slot.note === 'userPick') continue;
    const media = options.media.get(candidateKey(pick));
    if (!media) return err(MediaMissing({ assetId: pick.assetId }));
    const position = positions(items).find((candidate) => candidate.item.slotId === slotId);
    if (!position) return err(ItemNotFound({ itemId: slotId }));
    const current = position.item;
    if (current.type === 'clip' && current.locked) continue;
    const base: Clip =
      current.type === 'clip'
        ? current
        : {
            type: 'clip',
            // The gap's id carries over: selection and the cast board keep pointing at the slot.
            id: current.id,
            media,
            sourceStart: pick.sourceStart,
            duration: current.duration,
            speed: null,
            slotId: current.slotId,
            syncPoint: null,
            beatAnchor: anchorAt(grid, position.start, rate),
            fit: 'cover',
            audio: { gainDb: 0, muted: true },
            locked: false,
            enabled: true,
            stillMotion: null,
            reframe: null,
          };
    const replacement = { media, sourceStart: pick.sourceStart, syncPoint: pick.syncPoint, candidate: pick };
    const next = replaceMedia(base, replacement, timeline);
    if (!next) return err(MediaTooShort({ clipId: base.id }));
    items[position.itemIndex] = next;
    const updated = withPick(slot, pick, {
      confidence: null,
      needsRerank: false,
      note: pick.parts.rerank !== null ? 'reranked' : slot.note === 'noCandidates' ? null : slot.note,
    });
    // FIX-CAST's rule, here too: the margin counts only as far as the pick fits, so a poor fit stays a weak pick.
    const confidence = Math.min(
      marginConfidence(pick.score, updated.alternates[0]?.score, options.tau),
      options.fitCap?.(pick) ?? 1,
    );
    slots.set(slotId, { ...updated, clipId: next.id, confidence });
  }
  const cast = { ...timeline.cast, slots: timeline.cast.slots.map((slot) => slots.get(slot.slotId) ?? slot) };
  const edited = withVideoItems({ ...timeline, cast }, items);
  const synced = resync(edited, { before: timeline, ...(options.config ? { config: options.config } : {}) });
  return ok({ timeline: synced, changed: ['tracks', 'markers', 'cast'] });
}
