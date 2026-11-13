// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every number smart reframe uses (SPEC P3.2), versioned. These are product knobs tuned on the reframe eval
 * set, not published values: the 1€ starting point follows the paper's tuning procedure (β = 0, lower the
 * minimum cutoff until a held subject is still, then raise β by factors of ten); the rest are the research's
 * starting points (research/reframe-vision.md).
 */
export const REFRAME_CONFIG = {
  version: 1,
  /** Source and canvas aspects within this share of each other need no reframe. */
  aspectTolerance: 0.01,
  /** A detection box counts at this confidence or more. */
  minConfidence: 0.5,
  /** Vision's "no score" answer is a constant 1.0; such a box covering more of the frame than this is ignored. */
  noScoreMaxArea: 0.6,
  /** A tracker sample below this confidence is dropped (the helper re-seeds at the next detection). */
  trackMinConfidence: 0.3,
  /** Without an accepted box this long, the crop eases to the frame centre. */
  noBoxSeconds: 1.0,
  /** A shot whose median subject covers less of the frame than this may be a wide static shot. */
  wideStaticArea: 0.08,
  /** Auto mode pads instead of cropping when the crop shows less than this share of the subject's height. */
  minSubjectCoverage: 0.6,
  /** For a human box alone, the followed point sits this far down from its top (keeps the head). */
  humanFocusDrop: 0.25,
  oneEuro: { minCutoffHz: 0.6, beta: 0.004, dCutoffHz: 1.0 },
  /** The hold deadzone, as a share of the source width (6 px on a 1080-tall 16:9 frame is about 0.5 %). */
  deadzoneFraction: 0.005,
  /**
   * The pan speed cap, in crop widths (or heights) per second. The SPEC's starting 0.5 lost a walking subject
   * (about 1 crop width a second across 16:9 footage reframed to 9:16) on 24 % of the synthetic eval frames;
   * 0.75 kept it on all of them; 1.0 leaves headroom for a brisk walk. Jitter doesn't depend on it (the
   * deadzone holds a still subject exactly).
   */
  maxSpeedCropsPerSecond: 1.0,
  /** QA (cropJitter): a step larger than this while the subject holds still is a violation. */
  holdStepPx: 0.5,
  /** QA (cropJitter): how long the raw point must stay in the deadzone for a hold to count. */
  holdSeconds: 0.5,
  /** QA (cropJitter): two direction changes inside this window with short legs are a wobble. */
  wobbleSeconds: 1.0,
  /** QA (subjectInFrame): a frame counts as in when this share of the reference box is on the canvas. */
  boxInsideShare: 0.95,
  /** QA (subjectInFrame): a clip passes when this share of its counted frames are in. */
  framesInShare: 0.95,
  /** QA (subjectInFrame): the probed crop must match the plan within this many canvas pixels. */
  probeTolerancePx: 1,
  /** Caption dodging: the gap kept between a moved cue and the face, canvas pixels. */
  captionGapPx: 24,
} as const;

export type ReframeConfig = typeof REFRAME_CONFIG;
