// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Motion as data (SPEC G.2): what a composition's layers hand tc.js, which turns it into tweens on one paused GSAP
 * timeline. Every value is a number or a string compile code built (numbers, units, Taalcut's own path data), never
 * text from a person or the model, and every property is on an allowlist tc.js checks again. Times are seconds on
 * the composition clock, from whole frames.
 */
import type { FrameRate } from '@taalcut/core';

/**
 * The properties tc.js applies: GSAP's names (its transform aliases, CSS properties and three plugins'). HFW1 widened
 * it to what HyperFrames compositions animate (lowered by workspace/lower): the scale and skew axes, 3D turns,
 * autoAlpha, sizes, corner radius, letter spacing and border colour.
 */
export const MOTION_PROPERTIES = [
  'opacity',
  'autoAlpha',
  'x',
  'y',
  'z',
  'xPercent',
  'yPercent',
  'scale',
  'scaleX',
  'scaleY',
  'rotation',
  'rotationX',
  'rotationY',
  'skewX',
  'skewY',
  'transformPerspective',
  'width',
  'height',
  'borderRadius',
  'letterSpacing',
  'borderColor',
  'transformOrigin',
  'filter',
  'clipPath',
  'color',
  'backgroundColor',
  'boxShadow',
  'objectPosition',
  'drawSVG',
  'morphSVG',
  'motionPath',
] as const;
export type MotionProperty = (typeof MOTION_PROPERTIES)[number];

/** MotionPathPlugin's value as Taalcut uses it: raw path data in the target's offset parent, no `align`. */
export interface MotionPathValue {
  readonly path: string;
  readonly autoRotate: boolean;
  readonly start: number;
  readonly end: number;
}

export type MotionValue = number | string | MotionPathValue;
export type MotionVars = Readonly<Partial<Record<MotionProperty, MotionValue>>>;

export const STAGGER_ORDERS = ['start', 'end', 'center', 'edges'] as const;
export type StaggerOrder = (typeof STAGGER_ORDERS)[number];

/** Elements by id, or the words or characters SplitText made of elements (in order, concatenated). */
export type MotionTargets =
  | { readonly ids: readonly string[] }
  | { readonly split: readonly string[]; readonly unit: 'lines' | 'words' | 'chars' };

/**
 * Spread over `amount` seconds in `from` order, so the total time never depends on how many units there are; or
 * `each` seconds apart (HFW1: a HyperFrames composition's own stagger, lowered as written).
 */
export type MotionStagger =
  | { readonly amount: number; readonly from: StaggerOrder; readonly each?: undefined }
  | { readonly each: number; readonly from: StaggerOrder; readonly amount?: undefined };

export interface MotionTween {
  /** An authored program's continuous source clock, driven by the master even after a trim. */
  readonly clock?: {
    readonly id: string;
    readonly start: number;
    readonly duration: number;
    readonly sourceStart: number;
  };
  readonly targets: MotionTargets;
  readonly at: number;
  /** 0 is a jump: `tl.set(targets, to, at)`. */
  readonly duration: number;
  readonly from: MotionVars;
  readonly to: MotionVars;
  /**
   * HFW1: 'from' is GSAP's `tl.from(targets, from, at)` (`to` is empty): the targets come from `from` to the state
   * they are in, as a HyperFrames composition's `tl.from` does. Absent: `tl.fromTo`.
   */
  readonly method?: 'from';
  /**
   * HFW1: GSAP's own `immediateRender` for the method, as a HyperFrames composition runs it (true for from and fromTo:
   * the first values show before the tween starts). Absent: tc.js's default, false.
   */
  readonly immediateRender?: boolean;
  /** A GSAP ease from EASES, an ease EASE_PATTERN matches, or 'cubic-bezier(x1, y1, x2, y2)' (CustomEase). Absent: linear. */
  readonly ease?: string;
  readonly stagger?: MotionStagger;
  /**
   * HFW1: GSAP's own `repeat` (1–20 more times), `yoyo` and `repeatDelay`, as a HyperFrames composition runs them:
   * the whole tween (a staggered one included) plays again, backwards on every other run when `yoyo`.
   */
  readonly repeat?: MotionRepeat;
}

export const MAX_REPEATS = 20;

export interface MotionRepeat {
  readonly count: number;
  readonly yoyo: boolean;
  /** Seconds between runs. */
  readonly delay: number;
}

export const SPLIT_TYPES = [
  'words',
  'chars',
  'words,chars',
  'lines',
  'lines,words',
  'lines,chars',
  'lines,words,chars',
] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

/** An element SplitText splits before the tweens are built (lines are Taalcut's own elements). */
/** The unit a split masks (HFW1: lines too). */
export type SplitMask = 'lines' | 'words' | 'chars';

export interface SplitSpec {
  readonly id: string;
  /** 'chars' alone (HFW1): letters without word boxes, as a HyperFrames composition may split. */
  readonly type: SplitType;
  /** Wraps each unit in an `overflow: clip` box for mask reveals. */
  readonly mask?: SplitMask;
}

export interface MotionPart {
  readonly tweens: readonly MotionTween[];
  readonly splits: readonly SplitSpec[];
}

export const NO_MOTION: MotionPart = { tweens: [], splits: [] };

/** GSAP's named eases a composition may use (tc.js refuses others). */
export const EASES = [
  'none',
  'power1.in',
  'power1.out',
  'power1.inOut',
  'power2.in',
  'power2.out',
  'power2.inOut',
  'power3.in',
  'power3.out',
  'power3.inOut',
  'expo.in',
  'expo.out',
  'expo.inOut',
  'sine.in',
  'sine.out',
  'sine.inOut',
  'back.in(1.4)',
  'back.in(1.7)',
  'back.out(1.7)',
  'elastic.out(1, 0.5)',
  'steps(1)',
] as const;
export type NamedEase = (typeof EASES)[number];

/**
 * HFW1: the rest of GSAP's own eases a HyperFrames composition may name: every family with in, out or inOut (bare is
 * out), back with an overshoot, elastic with an amplitude and period, and steps with a count. Numbers only.
 */
export const EASE_PATTERN =
  /^(?:(?:none|linear)|(?:power[0-4]|quad|cubic|quart|quint|strong|sine|expo|circ|bounce)(?:\.(?:in|out|inOut))?|back(?:\.(?:in|out|inOut))?(?:\(\d{1,2}(?:\.\d{1,3})?\))?|elastic(?:\.(?:in|out|inOut))?(?:\(\d{1,2}(?:\.\d{1,3})?(?:, ?\d(?:\.\d{1,3})?)?\))?|steps\(\d{1,3}\))$/;

export const CUBIC_BEZIER = /^cubic-bezier\(\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\)$/;

/** Frame k as seconds (k·den/num): the instant HyperFrames seeks for that frame. */
export const frameSeconds = (frame: number, rate: FrameRate): number => (frame * rate.den) / rate.num;

/**
 * Where a jump at frame k goes: half a frame before it, never below 0. A seek to any frame then lands clearly on one
 * side, whichever way the playhead came (GSAP resolves a zero-duration tween at the exact playhead by direction).
 */
export const jumpSeconds = (frame: number, rate: FrameRate): number =>
  Math.max(0, frameSeconds(frame - 0.5, rate));

/** Joins layers' parts in order. */
export function joinMotion(parts: readonly MotionPart[]): MotionPart {
  return { tweens: parts.flatMap((part) => part.tweens), splits: parts.flatMap((part) => part.splits) };
}

/** The element ids a tween's targets name (a split's element ids for split targets). */
export const targetIds = (targets: MotionTargets): readonly string[] =>
  'ids' in targets ? targets.ids : targets.split;
