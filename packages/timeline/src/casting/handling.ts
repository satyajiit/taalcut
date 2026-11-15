// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM2: the stretches of a shot where the camera is being handled, not filming (SPEC, "MOM2: handling stretches").
 *
 * Vision's describer states, for each moment of a shot, whether the camera is held on something on purpose or is
 * only being handled: raised, lowered, swung away, covered, put down, a take starting or stopping (core's
 * `ShotMoment.handling`, on the profile's moments). That is the model's statement from the frames; nothing here
 * reads a note's words. To the person such a stretch is not footage, so the tools keep clips off it:
 *
 * - a window "rests on" handling by the frames of it that lie in handling stretches;
 * - while some window of the slot's length lies in them for no more than `overlap` of its length (the shot has
 *   another stretch long enough), only the windows that lie in them the least may be chosen: `clearStarts`;
 * - when no window can (the whole shot is handling, or nothing else is long enough), nothing changes, and the tools
 *   that show the clip say what it plays.
 *
 * A shot with no moment stated as handling, a photo, and a shot described before MOM2 read as they always did.
 */
import { handlingDuring, type ShotProfile } from '@taalcut/core';
import type { CastingConfig } from './config';

export type HandlingConfig = CastingConfig['inPoint']['handling'];

export interface HandlingRead {
  /** Frames of the window that starts at `start` (media frames from the shot's start) inside handling stretches. */
  readonly inside: (start: number) => number;
  /** The least any window of this length lies in them. */
  readonly least: number;
  /** A window that keeps to the allowed overlap exists: the shot has another stretch long enough. */
  readonly avoidable: boolean;
}

/**
 * How windows of `window` media frames lie against the shot's handling stretches; null when there is nothing to
 * read: a photo, no stretch stated as handling, or a shot shorter than the window.
 */
export function handlingRead(
  profile: ShotProfile,
  window: number,
  config: HandlingConfig,
): HandlingRead | null {
  const moments = profile.moments ?? [];
  const length = Math.floor(profile.range.duration.value);
  const size = Math.round(window);
  if (profile.kind !== 'video' || size < 1 || size > length) return null;
  if (!moments.some((moment) => moment.handling)) return null;
  const inside = (start: number) => handlingDuring(moments, start, start + size);
  let least = Number.POSITIVE_INFINITY;
  for (let start = 0; start + size <= length && least > 0; start++) least = Math.min(least, inside(start));
  return { inside, least, avoidable: least <= config.overlap * size };
}

/**
 * The window starts that keep off the shot's handling stretches as far as any window can; null when none is stated
 * or none can be avoided, and every start stands as before.
 */
export function clearStarts(
  profile: ShotProfile,
  window: number,
  config: HandlingConfig,
): ((start: number) => boolean) | null {
  const read = handlingRead(profile, window, config);
  if (!read?.avoidable) return null;
  return (start) => read.inside(start) <= read.least;
}

/** What a placed window is to the shot's handling stretches. */
export interface HandlingVerdict {
  /** The share of the window that lies in handling stretches, 0..1. */
  readonly share: number;
  /** It lies in them beyond the allowed overlap while another window of the shot keeps to it. */
  readonly rests: boolean;
  /** It lies in them beyond the allowed overlap and no window of the shot can do better: nothing to move to. */
  readonly unavoidable: boolean;
}

/** A window of `window` media frames from `start`, against the shot's handling stretches; null as `handlingRead`. */
export function handlingVerdict(
  profile: ShotProfile,
  start: number,
  window: number,
  config: HandlingConfig,
): HandlingVerdict | null {
  const read = handlingRead(profile, window, config);
  if (!read) return null;
  const size = Math.round(window);
  const over = read.inside(start) > config.overlap * size;
  return {
    share: Math.round((read.inside(start) / size) * 1000) / 1000,
    rests: over && read.avoidable,
    unavoidable: over && !read.avoidable,
  };
}
