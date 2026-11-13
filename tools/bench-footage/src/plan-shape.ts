// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a clip's plan is (plan.ts plans one from the seed, plan-script.ts from a script): its shots, every cut,
 * dissolve and fade with its time, the on-screen lines and the music; and the millisecond rounding every time in
 * it uses.
 */
import type { Look } from './look-names';
import type { ClipSpec, FadeEntry } from './sets/types';

/** Seconds to the millisecond, so sums of planned times stay exact. */
export const round = (value: number) => Math.round(value * 1000) / 1000;

export interface ShotPlan {
  readonly look: Look;
  /** The shot's own length; a dissolve overlaps it with the shot before by `dissolve` seconds. */
  readonly seconds: number;
  /** Seconds of dissolve from the shot before; 0 is a hard cut (and the first shot). */
  readonly dissolve: number;
  /** A fade through black (or a cut to black and back) from the shot before; scripted clips only. */
  readonly fade?: FadeEntry;
  /** Low-key: dark, and now and then black by blackdetect's rule, without a fade; scripted clips only. */
  readonly dark?: boolean;
  /** Where the shot starts in the clip. */
  readonly startsAt: number;
  /** Per-look parameters (colours, fractal centre, automaton rule, pan direction), from the seed. */
  readonly seed: number;
  readonly text: { readonly line: string; readonly from: number; readonly to: number } | null;
}

export interface CutMark {
  /** Seconds into the clip where the change begins. */
  readonly at: number;
  /** `fade`: through black, from the fade out's first frame (or the black's) to the fade in's last. */
  readonly kind: 'cut' | 'dissolve' | 'fade';
  /** A dissolve's or a fade's length; 0 for a cut. */
  readonly seconds: number;
}

export interface ClipPlan {
  readonly clip: ClipSpec;
  readonly shots: readonly ShotPlan[];
  readonly cuts: readonly CutMark[];
  readonly texts: readonly { readonly line: string; readonly from: number; readonly to: number }[];
  readonly music: { readonly bpm: number; readonly rootHz: number } | null;
  readonly noiseSeed: number;
}
