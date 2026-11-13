// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A crop path as a HyperFrames transform (SPEC P3.2, "Rendering"): the visual element keeps its canvas size and
 * `object-fit: cover`; `object-position` keyframes pan the cover window over the media, and a punch-in is CSS
 * `scale` about a `transform-origin` (animated when the followed point moves). Percent positions are
 * resolution independent, so preview proxies (the whole frame) and export segments (only the path's extent,
 * at the crop's scale) frame alike. One keyframe per path key, linear between them: that is the path's linear
 * resample, so preview framing is export framing.
 *
 * The punch-in folds into the visual's `scale` track: a static `scale: s`, and a `scale` track resting at s
 * whose `scaleBy` multiplies the element's other scale segments (a zoom transition), so no animation replaces
 * the punch-in (framingTracks; compile/animations.ts applies it).
 */
import type { FrameRate, Rect } from '@taalcut/core';
import { trackAnimation, type Segment, type TrackValue } from '../compile/tracks';
import type { MotionTween } from '../motion/motion-data';
import type { FrameSpan } from '../plan/types';
import type { ProbedVisual } from '../types';
import {
  coverFromShare,
  coverWindow,
  objectPositionShare,
  placeWindow,
  windowCrop,
  type Size,
} from './crop-window';
import type { SourceRect, VisualFraming } from './framing-types';

type CropFraming = Extract<VisualFraming, { kind: 'crop' }>;

const evenRound = (value: number) => Math.max(2, 2 * Math.round(value / 2));
const evenFloor = (value: number) => Math.max(0, 2 * Math.floor(value / 2));
const fixed = (value: number, digits: number) => String(Number(value.toFixed(digits)));

export interface FramingGeometry {
  /** The upright source scaled to this many pixels (even). */
  readonly scaledSize: Size;
  /** The part of the scaled frame the segment keeps, pixels (even); its extent in source fractions below. */
  readonly crop: Rect;
  readonly extent: SourceRect;
}

/** The union of the cover windows the path passes through: the media region the element must hold. */
function pathExtent(framing: CropFraming, window: Size): SourceRect {
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const key of framing.keys) {
    const { cover } = placeWindow(key.rect, window, framing.scale);
    x0 = Math.min(x0, cover.x);
    y0 = Math.min(y0, cover.y);
    x1 = Math.max(x1, cover.x + window.width);
    y1 = Math.max(y1, cover.y + window.height);
  }
  if (framing.keys.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: x0, y: y0, width: Math.min(1, x1) - x0, height: Math.min(1, y1) - y0 };
}

/**
 * The conform step's geometry for a crop: the source scaled so the crop window maps onto the canvas at the
 * display's pixel density (never above the source's own resolution: upscaling adds no detail the browser
 * can't add), cut to the path's extent. A still crop keeps exactly one cover window.
 */
export function framingGeometry(framing: CropFraming, source: Size, canvas: Size): FramingGeometry {
  const window = coverWindow(source.width / source.height, canvas.width / canvas.height);
  const cover = canvas.width / (window.width * source.width);
  const magnify = Math.max(cover, Math.min(cover * framing.scale, 1));
  const scaledSize = { width: evenRound(source.width * magnify), height: evenRound(source.height * magnify) };
  const wanted = pathExtent(framing, window);
  const x = evenFloor(wanted.x * scaledSize.width);
  const y = evenFloor(wanted.y * scaledSize.height);
  const width = Math.min(
    scaledSize.width - x,
    evenRound(Math.ceil((wanted.x + wanted.width) * scaledSize.width) - x),
  );
  const height = Math.min(
    scaledSize.height - y,
    evenRound(Math.ceil((wanted.y + wanted.height) * scaledSize.height) - y),
  );
  return {
    scaledSize,
    crop: { x, y, width, height },
    extent: {
      x: x / scaledSize.width,
      y: y / scaledSize.height,
      width: width / scaledSize.width,
      height: height / scaledSize.height,
    },
  };
}

/** The blurred pad's conform size: the whole frame contained in the canvas, no bars (the composition pads). */
export function blurPadGeometry(source: Size, canvas: Size): Size {
  const fit = Math.min(canvas.width / source.width, canvas.height / source.height);
  return { width: evenRound(source.width * fit), height: evenRound(source.height * fit) };
}

export interface FramingStyleInput {
  /** The element's id in the composition (its `data-tc-visual` holds the visual id). */
  readonly elementId: string;
  readonly framing: CropFraming;
  /** The media region the element shows: the export segment's extent, or the whole frame for a proxy. */
  readonly extent: SourceRect;
  readonly canvas: Size;
  /** Upright source width / height. */
  readonly sourceAspect: number;
  /** The visual's visible window on the render. */
  readonly visible: FrameSpan;
  readonly rate: FrameRate;
}

interface KeyStyle {
  readonly frame: number;
  readonly position: string;
  readonly origin: string;
}

function keyStyles(input: FramingStyleInput): KeyStyle[] {
  const window = coverWindow(input.sourceAspect, input.canvas.width / input.canvas.height);
  const { extent, canvas, framing } = input;
  return framing.keys.map((key) => {
    const placed = placeWindow(key.rect, window, framing.scale);
    const px = objectPositionShare(placed.cover.x, extent.x, extent.width, window.width) * 100;
    const py = objectPositionShare(placed.cover.y, extent.y, extent.height, window.height) * 100;
    return {
      frame: key.frame,
      position: `${fixed(px, 4)}% ${fixed(py, 4)}%`,
      origin: `${fixed(placed.origin.x * canvas.width, 3)}px ${fixed(placed.origin.y * canvas.height, 3)}px`,
    };
  });
}

/** A property's path as frame segments, one per pair of keys; null when it never changes. */
function trackOf(
  input: FramingStyleInput,
  styles: readonly KeyStyle[],
  property: 'objectPosition' | 'transformOrigin',
  value: (style: KeyStyle) => string,
): FramingTrack | null {
  const first = styles[0];
  if (!first || new Set(styles.map(value)).size <= 1) return null;
  const segments: Segment[] = [];
  for (let index = 1; index < styles.length; index++) {
    const left = styles[index - 1];
    const right = styles[index];
    if (!left || !right) continue;
    const from = input.visible.start + left.frame;
    segments.push({ from, to: input.visible.start + right.frame, start: value(left), end: value(right) });
  }
  return { property, rest: value(first), segments };
}

/** A crop path's animated property: its value before the first key and its segments on the render's frames. */
export interface FramingTrack {
  readonly property: 'objectPosition' | 'transformOrigin' | 'scale';
  readonly rest: TrackValue;
  readonly segments: readonly Segment[];
  /** On `scale` only: the punch-in, which multiplies any other scale animation of the element (zoom transitions). */
  readonly scaleBy?: number;
}

/**
 * The crop framing as a tc.css rule and frame tracks, for a composition that merges them with the element's
 * other animations (compile/animations.ts visualAnimations). The punch-in is a `scale` track with no segments
 * of its own: it rests at s and scales a transition's zoom.
 */
export function framingTracks(input: FramingStyleInput): { css: string[]; tracks: FramingTrack[] } {
  const styles = keyStyles(input);
  const first = styles[0];
  const punch = input.framing.scale > 1 + 1e-9;
  const scale = fixed(input.framing.scale, 4);
  const rule =
    `#${input.elementId} { object-fit: cover; object-position: ${first?.position ?? '50% 50%'};` +
    (punch ? ` scale: ${scale}; transform-origin: ${first?.origin ?? '50% 50%'};` : '') +
    ' }';
  const tracks = [
    trackOf(input, styles, 'objectPosition', (style) => style.position),
    punch ? trackOf(input, styles, 'transformOrigin', (style) => style.origin) : null,
    punch
      ? { property: 'scale' as const, rest: Number(scale), segments: [], scaleBy: input.framing.scale }
      : null,
  ].filter((track): track is FramingTrack => track !== null);
  return { css: [rule], tracks };
}

/** tc.css rules and tweens that draw a crop framing on its element, alone (no other animation on it). */
export function framingStyle(input: FramingStyleInput): { css: string[]; tweens: MotionTween[] } {
  const { css, tracks } = framingTracks(input);
  const tweens = tracks.flatMap((track) =>
    trackAnimation(input.elementId, track.property, input.visible, track.rest, track.segments, input.rate),
  );
  return { css, tweens };
}

const PERCENT_PAIR = /^\s*(-?[\d.]+)%\s+(-?[\d.]+)%\s*$/;
const PIXEL_PAIR = /^\s*(-?[\d.]+)px\s+(-?[\d.]+)px/;

/** The crop Chrome actually drew, from the probe's computed styles; null when a value doesn't parse. */
export function probedCrop(
  probed: Pick<ProbedVisual, 'objectPosition' | 'scale' | 'transformOrigin'>,
  frame: { readonly canvas: Size; readonly extent: SourceRect; readonly sourceAspect: number },
): SourceRect | null {
  const position = PERCENT_PAIR.exec(probed.objectPosition);
  if (!position) return null;
  // The probe reports the effective scale: CSS `scale` times the transform's (GSAP folds one into the other).
  const scaleText = probed.scale.trim().split(/\s+/)[0] ?? 'none';
  const scale = scaleText === 'none' ? 1 : Number(scaleText);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const origin = PIXEL_PAIR.exec(probed.transformOrigin);
  const { canvas, extent } = frame;
  const window = coverWindow(frame.sourceAspect, canvas.width / canvas.height);
  const cover = {
    x: coverFromShare(Number(position[1]) / 100, extent.x, extent.width, window.width),
    y: coverFromShare(Number(position[2]) / 100, extent.y, extent.height, window.height),
  };
  const share = origin
    ? { x: Number(origin[1]) / canvas.width, y: Number(origin[2]) / canvas.height }
    : { x: 0.5, y: 0.5 };
  return windowCrop({ cover, origin: share }, window, scale);
}
