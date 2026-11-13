// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every motion in a composition, as GSAP tweens for tc.js (SPEC G.2): transitions on the two clips they join
 * (opacity, xPercent/yPercent, scale and blur), the tracks other parts add to a visual (still motion, a
 * reframe's crop) and text reveals; caption word highlights are in caption-motion.ts. Pure; times are frames
 * until tracks.ts turns them into seconds.
 */
import type { FrameRate } from '@taalcut/core';
import type { FrameSpan, PlannedText, PlannedTransition, PlannedVisual, RenderPlan } from '../plan/types';
import type { MotionTween } from '../motion/motion-data';
import {
  motionFrames,
  trackAnimation,
  type AnimatedProperty,
  type Segment,
  type TrackValue,
} from './tracks';

export const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';
const WHIP = 'cubic-bezier(0.7, 0, 0.3, 1)';

/** Element ids in the composition, from plan ids. */
export const elementId = {
  visual: (visual: Pick<PlannedVisual, 'id' | 'kind'>) =>
    `${visual.kind === 'image' ? 'i' : 'v'}-${visual.id}`,
  text: (id: string) => `t-${id}`,
  cue: (id: string) => `q-${id}`,
  word: (cueIndex: number, wordIndex: number) => `w-${cueIndex}-${wordIndex}`,
  flash: (id: string) => `f-${id}`,
  /** A blurred pad's background copy of a visual (P3-V2). */
  pad: (visual: Pick<PlannedVisual, 'id' | 'kind'>) => `p-${visual.id}`,
  /** A motion graphic's root (P3-V13). */
  graphic: (id: string) => `g-${id}`,
};

type Tracks = Map<AnimatedProperty, Segment[]>;

function add(tracks: Tracks, property: AnimatedProperty, segment: Segment): void {
  if (segment.to < segment.from) return;
  const list = tracks.get(property) ?? [];
  list.push(segment);
  tracks.set(property, list);
}

export const REST: Record<AnimatedProperty, TrackValue> = {
  opacity: 1,
  x: 0,
  y: 0,
  xPercent: 0,
  yPercent: 0,
  scale: 1,
  rotation: 0,
  filter: 'blur(0px)',
  color: 'inherit',
  backgroundColor: 'transparent',
  boxShadow: 'none',
  clipPath: 'inset(0% 0% 0% 0%)',
  objectPosition: '50% 50%',
  transformOrigin: '50% 50%',
};

/** A slide moves along one axis by the clip's own size: [property, incoming from, outgoing to]. */
const SLIDE: Record<string, [AnimatedProperty, number, number]> = {
  slideLeft: ['xPercent', 100, -100],
  slideRight: ['xPercent', -100, 100],
  slideUp: ['yPercent', 100, -100],
  slideDown: ['yPercent', -100, 100],
  whipPan: ['xPercent', 100, -100],
};

/** The segments one transition adds to its outgoing and incoming clips. */
function transitionSegments(transition: PlannedTransition, outgoing: Tracks, incoming: Tracks): void {
  const { span, cut } = transition;
  const whole = { from: span.start, to: span.end };
  switch (transition.effect) {
    case 'crossfade':
      add(incoming, 'opacity', { ...whole, start: 0, end: 1 });
      return;
    case 'dipToBlack':
      add(outgoing, 'opacity', { from: span.start, to: cut, start: 1, end: 0 });
      // The incoming clip is on top from span.start: hidden until the dip reaches black at the cut.
      add(incoming, 'opacity', { from: span.start, to: span.start, start: 1, end: 0 });
      add(incoming, 'opacity', { from: cut, to: span.end, start: 0, end: 1 });
      return;
    case 'dipToWhite':
    case 'flash':
      // The white overlay does the visible work; the clips just cut at the cut.
      add(outgoing, 'opacity', { from: cut, to: cut, start: 1, end: 0 });
      add(incoming, 'opacity', { from: span.start, to: span.start, start: 1, end: 0 });
      add(incoming, 'opacity', { from: cut, to: cut, start: 0, end: 1 });
      return;
    case 'zoomIn':
    case 'zoomOut': {
      const [inFrom, outTo] = transition.effect === 'zoomIn' ? [0.85, 1.3] : [1.3, 0.85];
      add(outgoing, 'scale', { ...whole, start: 1, end: outTo, easing: EASE_IN_OUT });
      add(outgoing, 'opacity', { ...whole, start: 1, end: 0, easing: EASE_IN_OUT });
      add(incoming, 'scale', { ...whole, start: inFrom, end: 1, easing: EASE_IN_OUT });
      add(incoming, 'opacity', { ...whole, start: 0, end: 1, easing: EASE_IN_OUT });
      return;
    }
    default: {
      const slide = SLIDE[transition.effect];
      if (!slide) return;
      const easing = transition.effect === 'whipPan' ? WHIP : EASE_IN_OUT;
      const [property, inFrom, outTo] = slide;
      add(incoming, property, { ...whole, start: inFrom, end: 0, easing });
      add(outgoing, property, { ...whole, start: 0, end: outTo, easing });
      if (transition.effect === 'whipPan') {
        add(outgoing, 'filter', { ...whole, start: 'blur(0px)', end: 'blur(28px)', easing });
        add(incoming, 'filter', { ...whole, start: 'blur(28px)', end: 'blur(0px)', easing });
      }
    }
  }
}

/** The white overlay of a flash or a dip to white: up to full at the cut, then down. */
function flashAnimation(transition: PlannedTransition, rate: FrameRate): MotionTween[] {
  if (transition.effect !== 'flash' && transition.effect !== 'dipToWhite') return [];
  const { span, cut } = transition;
  return trackAnimation(
    elementId.flash(transition.id),
    'opacity',
    span,
    0,
    [
      { from: span.start, to: cut, start: 0, end: 1 },
      { from: cut, to: span.end, start: 1, end: 0 },
    ],
    rate,
  );
}

/** A property track a visual gets besides its transitions: still motion (P3-B7), a reframe's crop (P3-V2). */
export interface ExtraTrack {
  readonly property: AnimatedProperty;
  /** The value outside the segments (a punch-in's scale rests at its scale, not 1). */
  readonly rest: TrackValue;
  readonly segments: readonly Segment[];
  /** `scale` only: multiplies every other scale segment of the visual (a reframe punch-in under a zoom). */
  readonly scaleBy?: number;
}

/** A scale multiplied by a factor, at four decimals. */
const scaled = (value: TrackValue, factor: number): TrackValue =>
  typeof value === 'number' ? Number((value * factor).toFixed(4)) : value;

/** The visual's scale segments so far, multiplied (a punch-in under the transitions' zooms). */
function multiplyScale(tracks: Tracks, factor: number): void {
  const segments = tracks.get('scale');
  if (!segments || factor === 1) return;
  tracks.set(
    'scale',
    segments.map((segment) => ({
      ...segment,
      start: scaled(segment.start, factor),
      end: scaled(segment.end, factor),
    })),
  );
}

/**
 * Per visual, the tracks it adds on top of its transitions. `busy` holds the frames each property is
 * already animated by a transition, so a still's push or pan stays clear of a zoom or slide.
 */
export type ExtraTracks = (
  visual: PlannedVisual,
  busy: ReadonlyMap<AnimatedProperty, readonly FrameSpan[]>,
) => readonly ExtraTrack[];

function busySpans(tracks: Tracks | undefined): Map<AnimatedProperty, FrameSpan[]> {
  const busy = new Map<AnimatedProperty, FrameSpan[]>();
  for (const [property, segments] of tracks ?? [])
    busy.set(
      property,
      segments.map((segment) => ({ start: segment.from, end: segment.to })),
    );
  return busy;
}

/** A visual's extra tracks merged into its own (a punch-in scales its zooms first); their rest values. */
function mergeExtra(tracks: Tracks, added: readonly ExtraTrack[]): Map<AnimatedProperty, TrackValue> {
  const rests = new Map<AnimatedProperty, TrackValue>();
  for (const track of added) {
    if (track.scaleBy !== undefined) multiplyScale(tracks, track.scaleBy);
    for (const segment of track.segments) add(tracks, track.property, segment);
    rests.set(track.property, track.rest);
  }
  return rests;
}

/** Transitions, extra tracks and flash overlays: every visual animation of a plan, in a stable order. */
export function visualAnimations(plan: RenderPlan, extra: ExtraTracks = () => []): MotionTween[] {
  const tracks = new Map<string, Tracks>();
  const rests = new Map<string, Map<AnimatedProperty, TrackValue>>();
  const of = (id: string) => {
    let found = tracks.get(id);
    if (!found) tracks.set(id, (found = new Map()));
    return found;
  };
  for (const transition of plan.transitions)
    transitionSegments(transition, of(transition.from), of(transition.to));
  for (const visual of plan.visuals)
    rests.set(visual.id, mergeExtra(of(visual.id), extra(visual, busySpans(tracks.get(visual.id)))));
  const animations: MotionTween[] = [];
  for (const visual of plan.visuals) {
    if (!visual.enabled) continue;
    for (const [property, segments] of tracks.get(visual.id) ?? []) {
      const rest = rests.get(visual.id)?.get(property) ?? REST[property];
      animations.push(
        ...trackAnimation(elementId.visual(visual), property, visual.visible, rest, segments, plan.rate),
      );
    }
  }
  for (const transition of plan.transitions) animations.push(...flashAnimation(transition, plan.rate));
  return animations;
}

/** Frames of a text reveal: about a quarter second, never more than a third of the item. */
const revealFrames = (span: FrameSpan, rate: FrameRate) => motionFrames(0.25, rate, span);

export function textAnimations(texts: readonly PlannedText[], rate: FrameRate): MotionTween[] {
  const animations: MotionTween[] = [];
  for (const text of texts) {
    const target = elementId.text(text.id);
    const end = text.span.start + revealFrames(text.span, rate);
    const reveal = { from: text.span.start, to: end, easing: EASE_IN_OUT };
    const specs: [AnimatedProperty, TrackValue, Segment][] = [];
    switch (text.reveal) {
      case 'fade':
      case 'wordByWord':
        specs.push(['opacity', 1, { ...reveal, start: 0, end: 1 }]);
        break;
      case 'pop':
        specs.push(['opacity', 1, { ...reveal, start: 0, end: 1 }]);
        specs.push(['scale', 1, { ...reveal, start: 0.85, end: 1 }]);
        break;
      case 'slide':
        specs.push(['opacity', 1, { ...reveal, start: 0, end: 1 }]);
        specs.push(['y', 0, { ...reveal, start: 48, end: 0 }]);
        break;
      case 'typewriter': {
        const typed = text.span.start + Math.max(1, Math.floor((text.span.end - text.span.start) * 0.4));
        specs.push([
          'clipPath',
          REST.clipPath,
          { from: text.span.start, to: typed, start: 'inset(0% 100% 0% 0%)', end: REST.clipPath },
        ]);
        break;
      }
      default:
        break;
    }
    for (const [property, rest, segment] of specs)
      animations.push(...trackAnimation(target, property, text.span, rest, [segment], rate));
  }
  return animations;
}
