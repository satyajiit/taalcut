// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How one visual fills the output canvas (SPEC P3.2), decided per export by the `reframing` stage and read by
 * conform (segment geometry), the composition (object-position, scale and transform-origin keyframes) and QA
 * (subjectInFrame, cropJitter, captionCoversFace). Pure data.
 */

/** A rectangle as fractions of the upright source frame, origin top left. */
export interface SourceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A point as fractions of the upright source frame. */
export interface SourcePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The crop window at one render frame. `frame` counts from the visual's `visible.start`; between keys the
 * window moves linearly (the path is already smoothed and speed-clamped, so linear resampling adds no jitter).
 */
export interface CropKey {
  readonly frame: number;
  readonly rect: SourceRect;
}

/** Why a reframed visual got the framing it has (for QA findings and the export's warnings). */
export const FRAMING_REASONS = [
  /** The subject was followed. */
  'subject',
  /** The person chose it. */
  'forced',
  /** No accepted box: the centre crop. */
  'noSubject',
  /** Wide static shot: whole frame over a blurred copy. */
  'wideStatic',
  /** The subject can't fit the crop (9:16 footage into 16:9): blurred pad. */
  'subjectTooTall',
  /** No subject track (no helper, not macOS, or tracking failed): the centre crop, with a warning. */
  'noTrack',
] as const;
export type FramingReason = (typeof FRAMING_REASONS)[number];

export type VisualFraming =
  /** Phase 2: the clip's `fit` decides (cover is a centre crop, contain shows bars). Same-aspect clips. */
  | { readonly kind: 'fit' }
  /**
   * A crop window of the canvas aspect (pan and tilt; `scale` > 1 is a punch-in, the window shrunk about the
   * followed point) moving along `keys`. Every key's rect has the same width and height.
   */
  | {
      readonly kind: 'crop';
      readonly reason: FramingReason;
      readonly keys: readonly CropKey[];
      /** The subject's reference box (face, else human) per key, source fractions, for QA; null without one. */
      readonly subject: readonly (SourceRect | null)[];
      /** The punch-in (clip.reframe.scale): the window is the cover window shrunk by it. 1 is none. */
      readonly scale: number;
      /** The largest face box per key (source fractions), for captionCoversFace and caption dodging. */
      readonly faces: readonly (SourceRect | null)[];
      /** The raw followed point per key before smoothing (null where the crop eased to centre), for cropJitter. */
      readonly raw: readonly (SourcePoint | null)[];
    }
  /** The whole frame fitted over a blurred, darkened copy of itself. */
  | { readonly kind: 'blurPad'; readonly reason: FramingReason };

/** The framing of every visual in an export, by visual id; absent means `fit`. */
export interface FramingPlan {
  readonly sourceSizes?: ReadonlyMap<string, { readonly width: number; readonly height: number }>;
  readonly visuals: ReadonlyMap<string, VisualFraming>;
  /** One line per problem the export carries as a warning (no helper, a failed track). */
  readonly warnings: readonly string[];
}

export const NO_FRAMING: FramingPlan = { visuals: new Map(), warnings: [] };
