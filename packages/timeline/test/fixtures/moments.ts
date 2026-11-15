// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: made-up moments on a shot's profile. Vectors stand on two axes: `fits(1)` points at the slot's ask (`ASK`),
 * `fits(0)` away from it, and a value between sits between, so a note's cosine to the ask is the number given. The
 * template's other slots ask along other axes (`ASK_SET`), away from every such note: a note's usual nearness to the
 * template's slots is 0, so its fit for the asking slot is its cosine less the config's margin.
 */
import type { ShotProfile, ShotProfileMoment } from '@taalcut/core';
import { DIMS } from './library';

/** A unit vector along one axis. */
export function axis(index: number): Float32Array {
  const out = new Float32Array(DIMS);
  out[index] = 1;
  return out;
}

/** What the slot states, as a vector: the first axis. */
export const ASK = axis(0);

/** What two other slots of the template state: the third and fourth axes. */
export const OTHER_ASKS = [axis(2), axis(3)] as const;

/** Every slot's asks, the asking slot's first (moment-fit.ts `askSet`). */
export const ASK_SET: readonly (readonly Float32Array[])[] = [[ASK], [OTHER_ASKS[0]], [OTHER_ASKS[1]]];

/** A note's vector whose cosine to `ASK` is `cosine`. */
export function fits(cosine: number): Float32Array {
  const out = new Float32Array(DIMS);
  out[0] = cosine;
  out[1] = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  return out;
}

export interface MomentDef {
  /** Where it ends, in frames from the shot's start (it starts where the last ended). */
  readonly to: number;
  readonly note: string;
  /** Its note's cosine to `ASK`; null for a note not embedded yet. */
  readonly fit: number | null;
  /** MOM2: the describer stated the camera is being handled in it. */
  readonly handling?: true;
}

export function momentsOf(defs: readonly MomentDef[]): ShotProfileMoment[] {
  let start = 0;
  return defs.map((def) => {
    const moment = {
      start,
      end: def.to,
      note: def.note,
      vector: def.fit === null ? null : fits(def.fit),
      ...(def.handling ? { handling: true as const } : {}),
    };
    start = def.to;
    return moment;
  });
}

export const withMoments = (profile: ShotProfile, defs: readonly MomentDef[]): ShotProfile => ({
  ...profile,
  moments: momentsOf(defs),
});
