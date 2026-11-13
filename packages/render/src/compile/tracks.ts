// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tracks as GSAP tweens (SPEC G.2). One track per element and property over the element's window, its segments
 * never overlapping, so two effects on one element (a transition in and another out, still motion under a slide)
 * never fight. A track is a `set` of its rest value at 0, then one `fromTo` per segment with both ends explicit
 * (nothing is read from the page), and each jump (a zero-length segment) a `set` half a frame before its frame.
 *
 * GSAP renders a timeline's children backwards when the playhead moves back, so at frame k a tween that ends at k
 * would be drawn after one that starts there. Where a segment starts on a different value from where the one
 * before it ended, at that frame, the earlier tween ends half a frame sooner; at every frame time the value is then
 * the same whichever way the playhead came.
 */
import type { FrameRate } from '@taalcut/core';
import type { FrameSpan } from '../plan/types';
import { frameSeconds, jumpSeconds, type MotionProperty, type MotionTween } from '../motion/motion-data';

/** The properties a track animates (GSAP's names). */
export type AnimatedProperty = Extract<
  MotionProperty,
  | 'opacity'
  | 'x'
  | 'y'
  | 'xPercent'
  | 'yPercent'
  | 'scale'
  | 'rotation'
  | 'filter'
  | 'color'
  | 'backgroundColor'
  | 'boxShadow'
  | 'clipPath'
  | 'objectPosition'
  | 'transformOrigin'
>;

export type TrackValue = number | string;

/** A change of one property over [from, to) frames; from === to is a jump. */
export interface Segment {
  readonly from: number;
  readonly to: number;
  readonly start: TrackValue;
  readonly end: TrackValue;
  /** A GSAP ease or a CSS cubic-bezier (CustomEase); absent is linear. */
  readonly easing?: string;
}

const clampTo = (frame: number, window: FrameSpan) => Math.min(Math.max(frame, window.start), window.end);

/**
 * The tweens of one property of `target` over `window`, resting at `rest` before its first segment and holding the
 * last value after. Segments are clamped to the window and must not overlap. Empty for an empty window or none.
 */
export function trackAnimation(
  target: string,
  property: AnimatedProperty,
  window: FrameSpan,
  rest: TrackValue,
  segments: readonly Segment[],
  rate: FrameRate,
): MotionTween[] {
  if (window.end - window.start <= 0 || segments.length === 0) return [];
  const sorted = [...segments]
    .map((segment) => ({ ...segment, from: clampTo(segment.from, window), to: clampTo(segment.to, window) }))
    .sort((a, b) => a.from - b.from);
  const first = sorted[0];
  // What shows at frame 0: a segment that starts there sets it (a set and a tween at 0 must agree).
  const initial = first && first.from === 0 ? (first.to <= first.from ? first.end : first.start) : rest;
  return new TrackBuilder(target, property, rate, initial).segments(sorted).tweens;
}

class TrackBuilder {
  readonly tweens: MotionTween[];
  private value: TrackValue;
  /** The last tween and the frame it ends on. */
  private open: { readonly index: number; readonly to: number } | null = null;
  private readonly targets: { readonly ids: readonly string[] };

  constructor(
    target: string,
    private readonly property: AnimatedProperty,
    private readonly rate: FrameRate,
    initial: TrackValue,
  ) {
    this.targets = { ids: [target] };
    this.value = initial;
    this.tweens = [{ targets: this.targets, at: 0, duration: 0, from: {}, to: { [property]: initial } }];
  }

  segments(sorted: readonly Segment[]): this {
    for (const segment of sorted) {
      const still = segment.to <= segment.from || segment.start === segment.end;
      if (still) this.jumpTo(segment.from, segment.end);
      else this.tween(segment);
    }
    return this;
  }

  /** The value changes at `frame` with nothing moving (a jump, or a hold that starts on a new value). */
  private jumpTo(frame: number, value: TrackValue): void {
    if (value === this.value) return;
    this.yieldFrame(frame);
    this.tweens.push({
      targets: this.targets,
      at: jumpSeconds(frame, this.rate),
      duration: 0,
      from: {},
      to: { [this.property]: value },
    });
    this.value = value;
  }

  private tween(segment: Segment): void {
    if (segment.start !== this.value) this.yieldFrame(segment.from);
    this.tweens.push({
      targets: this.targets,
      at: frameSeconds(segment.from, this.rate),
      duration: frameSeconds(segment.to - segment.from, this.rate),
      from: { [this.property]: segment.start },
      to: { [this.property]: segment.end },
      ease: segment.easing ?? 'none',
    });
    this.open = { index: this.tweens.length - 1, to: segment.to };
    this.value = segment.end;
  }

  /** A new value at `frame`: a tween ending on that frame ends half a frame sooner (see the file comment). */
  private yieldFrame(frame: number): void {
    if (this.open === null || this.open.to !== frame) return;
    const earlier = this.tweens[this.open.index];
    if (earlier)
      this.tweens[this.open.index] = {
        ...earlier,
        duration: earlier.duration - frameSeconds(0.5, this.rate),
      };
    this.open = null;
  }
}

/** A property that jumps to `on` over [from, to) and back to `off` (caption word highlights). */
export function stepAnimation(
  target: string,
  property: AnimatedProperty,
  window: FrameSpan,
  off: TrackValue,
  on: TrackValue,
  span: FrameSpan,
  rate: FrameRate,
): MotionTween[] {
  return trackAnimation(
    target,
    property,
    window,
    off,
    [
      { from: span.start, to: span.start, start: off, end: on },
      { from: span.end, to: span.end, start: on, end: off },
    ],
    rate,
  );
}

/** `seconds` in frames: at least one, never more than a third of the span (short items move less). */
export function motionFrames(seconds: number, rate: FrameRate, span: FrameSpan): number {
  const frames = Math.round((seconds * rate.num) / rate.den);
  return Math.max(1, Math.min(frames, Math.floor((span.end - span.start) / 3)));
}
