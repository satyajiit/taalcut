// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The camera-motion estimator's and classifier's numbers (FRM1-MOT). The classifier's thresholds were fitted on the
 * train split of the camera-motion eval set (tools/evals/src/motion, `eval:motion -- --fit`) and are reported on its
 * held-out split; change them only by refitting. `version` goes into every measure, so a library shot measured
 * with other numbers is measured again.
 */
export const MOTION_CONFIG = {
  version: 1,
  /** Frames are read at this long side (aspect kept): enough for a corner to be a few pixels from its neighbour. */
  longSide: 384,
  /** Frame pairs a second; a short shot reads denser, to have `minPairs`. */
  rate: 10,
  minPairs: 6,
  /**
   * A library shot is measured over at most this many seconds at its middle (analysis/shot-camera.ts): a reel's
   * slot is a few seconds, a long shot is labelled by its middle, and indexing a long video stays bounded.
   */
  libraryWindow: 6,
  estimator: {
    /** Corners: one per cell of a grid with this many cells along the long side. */
    cellsOnLongSide: 24,
    cornerRelative: 0.01,
    cornerFloor: 25,
    /** Tracker window radius (7: 15×15), iterations, pyramid levels. */
    radius: 7,
    iterations: 12,
    levels: 4,
    /** The forward–backward check, level-0 pixels at a 384 px long side. */
    forwardBackward: 0.75,
    /** RANSAC: the inlier distance (pixels at 384), samples, and the fewest points a fit stands on. */
    inlierPixels: 1.2,
    ransacIterations: 160,
    minInliers: 8,
    /** A second motion (the subject) needs this share of the points, and at least `minSubjectPoints`. */
    layerShare: 0.03,
    minSubjectPoints: 5,
    /** The first layer is the background unless the second is spread over this many times more of the frame. */
    spreadRatio: 0.85,
    /**
     * Of two layers, one still (under 2 inlier distances anywhere) and one moving, the still one is the background
     * when it is spread over at least this share of the moving one's spread: a tripod is common, and a subject
     * filling a portrait frame can out-spread the background behind it.
     */
    stillBias: 0.6,
    /** Subject boxes grow by this share of their size before points are kept out. */
    boxGrow: 0.05,
    /** Fewer inliers than this share of the corners: track again from the whole picture's shift. */
    retryBelow: 0.35,
  },
  classifier: {
    /** Pan, tilt (long sides a second at the frame's long side) and zoom (edge speed, the same unit) that move. */
    moveSpeed: 0.03,
    /** A move stands out from the shake: its net travel is at least this many times the shake. */
    shakeRatio: 4,
    /** …and it travels at least this share of the long side over the shot: less is a hand's wander, not a pan. */
    minTravel: 0.03,
    /** Zoom wins over a shift when its edge speed is this many times the shift's. */
    zoomOverShift: 0.8,
    /** Shake (RMS, share of the long side) over a still or slow camera that is handheld. */
    jitter: 0.0006,
    /** A subject holds still while the background moves when it moves under this share of the background. */
    steadyShare: 0.6,
    /** …and at most this fast in the frame (long sides a second). */
    steadySpeed: 0.08,
    /**
     * A subject keeping its place over a background that moves at least this fast (and travels `followShake` times
     * its shake) is followed: tracking, under the pan line. A walk behind someone barely moves the far background.
     */
    followSpeed: 0.015,
    followShake: 4,
    /** …while the subject's own drift in the frame stays under this (long sides a second). */
    followSubject: 0.1,
    /** Measures under this confidence leave the label unsure. */
    sure: 0.5,
  },
} as const;

export type MotionConfig = typeof MOTION_CONFIG;
