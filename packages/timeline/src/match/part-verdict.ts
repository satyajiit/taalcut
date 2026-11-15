// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: the part of its shot a draft clip plays, against what its slot states, for render QA's `slotPart`. The
 * measure is casting's content term (casting/moment-fit.ts): the notes of the moments the clip plays, compared by
 * meaning with the slot's intent and needs (as far as they stand out from the template's other slots), relative to
 * the best part of the same length in the same shot. A clip
 * misses when its part fits `inPoint.content.missMargin` or more under the best: another stretch of the same shot
 * shows what the slot asks for and this one doesn't. The verdict says where the clip plays from and where the better
 * part starts, in seconds of the shot's file, so `timeline.slipClip` can move it.
 *
 * It reads what indexing already stored and the local text embedder: no vision model, cloud or local, no frame, and
 * no consent to upload pictures. Nothing here knows what a note or a slot is about. A shot without moments, a photo
 * and a slot that states nothing have no verdict.
 *
 * MOM2: a clip also misses when its part rests on a stretch the describer states as the camera being handled, beyond
 * `inPoint.handling.overlap` of the part, while the shot has a part of the same length that keeps off them
 * (casting/handling.ts). That needs no slot to state anything: the stretch is not footage for any slot. The better
 * part is then the clear one that fits the slot best, the nearest to where the clip plays among equals, and it is
 * never a part that rests on handling. A clip on a shot that can't keep off them does not miss: there is nothing in
 * that shot to move to.
 */
import { RationalTime, type Clip, type FrameRate, type ShotProfile } from '@taalcut/core';
import type { CastingConfig } from '../casting/config';
import { clearStarts, handlingVerdict } from '../casting/handling';
import { partFit, slotAsks, type PartFit } from '../casting/moment-fit';
import type { SlotNeed } from '../casting/needs';
import { consumedMedia } from '../model/speed';

export interface PartVerdict {
  /** The clip's part shows what the slot states about as well as the shot's best part does. */
  readonly met: boolean;
  /** How far its fit sits under the best part's (cosine, 0 when it is the best). */
  readonly under: number;
  /** Where the clip plays its shot from, and where the best part of the same length starts: seconds of the file. */
  readonly playsFrom: number;
  readonly betterFrom: number;
  /** MOM2: the share of the part (0..1) that lies in handling stretches, when the clip misses for resting on one. */
  readonly handling?: number;
}

const hundredth = (seconds: number) => Math.round(seconds * 100) / 100;

/** The clear window that fits best; among equals, the nearest to where the clip plays (the smallest slip). */
function bestClear(
  parts: PartFit | null,
  clear: (start: number) => boolean,
  window: number,
  length: number,
  at: number,
): { readonly start: number; readonly fit: number } | null {
  let found: { start: number; fit: number } | null = null;
  for (let start = 0; start + window <= length; start++) {
    if (!clear(start)) continue;
    const fit = parts ? parts.fit(start, start + window) : 0;
    const nearer = found !== null && Math.abs(start - at) < Math.abs(found.start - at);
    if (!found || fit > found.fit + 1e-12 || (Math.abs(fit - found.fit) <= 1e-12 && nearer))
      found = { start, fit };
  }
  return found;
}

export function partVerdict(
  clip: Pick<Clip, 'sourceStart' | 'duration' | 'speed' | 'media'>,
  shot: ShotProfile,
  slot: {
    readonly intentVector?: Float32Array | null;
    readonly needs: readonly SlotNeed[];
    /** Every slot's asks in the template, which the fit is read against (casting/moment-fit.ts). */
    readonly askSet?: readonly (readonly Float32Array[])[];
  },
  canvasRate: FrameRate,
  config: Pick<CastingConfig['inPoint'], 'content' | 'handling'>,
): PartVerdict | null {
  if (clip.media.kind !== 'video' || shot.kind !== 'video') return null;
  const rate = shot.range.start.rate;
  const length = shot.range.duration.value;
  const window = Math.min(
    length,
    RationalTime.rescale(consumedMedia(clip, rate, canvasRate), rate, 'ceil').value,
  );
  if (window < 1) return null;
  const from = RationalTime.subtract(
    RationalTime.rescale(clip.sourceStart, rate, 'round'),
    shot.range.start,
  ).value;
  // A clip that plays outside the shot's range (a trim past it) is read where it overlaps the shot.
  const at = Math.max(0, Math.min(length - window, from));
  const parts = partFit(shot, slotAsks(slot), slot.askSet, config.content.margin);
  // MOM2: the windows that keep off the shot's handling stretches, when it has any and a window can.
  const clear = clearStarts(shot, window, config.handling);
  const handled = handlingVerdict(shot, at, window, config.handling);
  const rests = handled?.rests === true;
  const best = clear ? bestClear(parts, clear, window, length, at) : (parts?.best(window) ?? null);
  if (!best) return null;
  const under = parts ? Math.max(0, best.fit - parts.fit(at, at + window)) : 0;
  const seconds = (frame: number) =>
    hundredth(RationalTime.toSeconds(RationalTime.add(shot.range.start, RationalTime.of(frame, rate))));
  return {
    met: !rests && under < config.content.missMargin,
    under: Math.round(under * 1000) / 1000,
    playsFrom: hundredth(RationalTime.toSeconds(clip.sourceStart)),
    betterFrom: seconds(best.start),
    ...(handled && rests ? { handling: handled.share } : {}),
  };
}
