// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every QA threshold, versioned with the report (docs/qa-gate.md, rule 7).
 * Tuned against the fixtures and, later, alpha telemetry; never edited inline
 * in a check. Loudness comes from the preset (−14 LUFS ± 1 LU, ≤ −1 dBTP), so
 * only the platform-independent numbers live here.
 */
export const QA_THRESHOLDS_VERSION = 1;

export const QA_THRESHOLDS = {
  /** The video pass decodes and downscales here before the CPU filters. */
  analysisSize: { width: 270, height: 480 },
  container: {
    /** Audio and video must both start at 0 after the edit lists. */
    startToleranceMs: 1,
  },
  codec: {
    /** H.264 level ≤ 4.2 (ffprobe reports 42). */
    maxH264Level: 42,
  },
  bitrate: {
    /** Warn outside ±25 % of the preset's target. */
    tolerance: 0.25,
  },
  black: {
    /** blackdetect=d=0.1:pic_th=0.98:pix_th=0.10 */
    minSeconds: 0.1,
    pictureRatio: 0.98,
    pixelLuma: 0.1,
  },
  frozen: {
    /** freezedetect=n=-50dB:d=0.5 on the render. */
    noiseDb: -50,
    minSeconds: 0.5,
    /**
     * The tolerance on a clip's conformed segment, asking whether the footage itself moves. A still
     * picture, re-encoded, can step one level in every plane between frames (−48 dB; VideoToolbox's rate
     * control does it on a busy Mac, one level of luma and one of chroma, −49.7 dB): at −50 dB that read
     * as motion, and the render was blamed for the footage's own stillness. `testsrc2`'s smallest motion
     * still reads as motion up to −41 dB.
     */
    footageNoiseDb: -45,
  },
  sceneChange: {
    /** scdet=threshold=8; a cut scoring under this is between near-identical shots and is skipped. */
    threshold: 8,
    /** A detected cut may sit within ±1 frame of the planned one; its peak must be on it. */
    searchFrames: 1,
  },
  blackBars: {
    /** bbox=min_val=24 stands in for cropdetect=limit=24 (cropdetect is GPL; the sidecar is LGPL). */
    minLuma: 24,
    /** The picture must cover at least this share of the width and the height. */
    minCoverage: 0.95,
    /** A smaller picture for this long inside one clip is a finding. */
    minSeconds: 1,
  },
  sync: {
    sampleRate: 16_000,
    maxLagMs: 250,
    /** Windows whose peak normalised correlation is under this are inconclusive. */
    minCorrelation: 0.3,
    maxOffsetMs: 20,
    /** Linear drift of the lag, extrapolated over 60 s. */
    maxDriftMs: 20,
    driftOverSeconds: 60,
    /** One AAC frame: the sample count may differ by this much. */
    sampleTolerance: 1024,
  },
  beat: {
    /** A beat-anchored cut within one frame of its beat (gate criterion 5). */
    maxFrames: 1,
  },
  silence: {
    /** max_volume at or under this is silence. */
    maxVolumeDb: -70,
  },
  captions: {
    /** Anti-aliasing slack on the safe rect. */
    safeTolerancePx: 2,
    /** A popped word may touch another word's box by this much (sub-pixel layout and anti-aliasing), no more. */
    wordOverlapTolerancePx: 1,
    /** Each cue on screen at least ⌈0.6 · rate⌉ frames. */
    minSeconds: 0.6,
    minSizePx: 44,
    /** WCAG contrast without a stroke ≥ 3 px or a background at opacity ≥ 0.5. */
    minContrast: 3,
    minStrokePx: 3,
    minBackgroundOpacity: 0.5,
  },
  /** EAR1-A2: the render heard (core's SoundListener). */
  sound: {
    onCuts: {
      /** The share of cuts with a planned effect whose sound lands (an onset within 100 ms, or a swell's peak). */
      minLandedShare: 0.9,
    },
    clean: {
      /** The audit's findings that mean a damaged mix; the rest describe one effect's design. */
      kinds: ['click', 'clipping', 'dc_offset'],
      /** A click this close to a placed sound effect is the effect's own (a UI click). */
      effectMarginMs: 20,
    },
    critique: {
      /** The critique warns at these verdicts (under 75 % or with a critical issue), never fails. */
      warnVerdicts: ['needs_work', 'not_launch_grade'],
      warnBelowScore: 0.75,
    },
  },
} as const;
