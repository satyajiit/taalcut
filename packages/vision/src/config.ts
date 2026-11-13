// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { SHOT_MODEL_CONFIG } from './cuts/model-config';

/**
 * Versioned thresholds and calibration (VISION_CONFIG v1). They start at the
 * values SPEC.md gives (published rules of thumb and the spikes) and are
 * tuned on the labelled sample libraries and golden reels, never by hand in
 * code. Bump `version` with any change: it is part of every job's
 * idempotency key and raises `vision.shots` and `vision.analyse` (stage-frames.ts `visionStageVersions`), so they
 * re-run; the stages that read them follow when what they store changed (dependent invalidation, IX3-I3).
 */

export const VISION_CONFIG = {
  version: 1,
  embed: {
    /**
     * `vision.embed`'s own version (stage-frames.ts `visionStageVersions`; it was added to VISION_CONFIG.version and
     * the detector's until IX3-I3), and part of its job key.
     * 1 (stage version 2): frame and on-screen text vectors only; transcripts moved to
     * `vision.embedText` (IX-E1). 2 (stage version 3): frames at 140 soft tokens instead of 280 (IX2-E1), so
     * libraries re-embed their frames; the Core ML backend alone would not have bumped it (cosine ≥ 0.999 to ONNX).
     * Bump with any change to what frames are embedded or how.
     */
    version: 2,
    // Soft tokens per frame, providers and call sizes are per machine: embed/profile.ts.
    /** Frames per shot, by hardware tier (PRD G14). */
    framesPerShot: {
      minimum: { base: 1, perSeconds: 0, max: 1 },
      recommended: { base: 1, perSeconds: 4, max: 4 },
      high: { base: 1, perSeconds: 2, max: 8 },
    },
  },
  shots: {
    /**
     * The shot detector's version, added to VISION_CONFIG.version for `vision.shots`. The stages that read the shots
     * re-run when the shots a detection stores change (dependent invalidation, IX3-I3; until then the detector's
     * version was added to every shot-keyed stage's, IX2-C5).
     * 0 was scdet with the embedding check (P2-L7); 1 is TransNetV2 (IX2-C4).
     */
    version: 1,
    /** First pass: one sample per this many fps. */
    fps: 10,
    longSide: 256,
    /** scdet score (0–100) that makes a candidate: high recall. */
    candidateScore: 8,
    /**
     * Cosine distance (frame c−2 against c+1) a cut needs at least. Flashes,
     * light changes and motion within a shot measure 0.00–0.03 on the
     * synthetic set; cuts between unrelated lavfi patterns 0.09–0.35 (they
     * sit close together in EmbeddingGemma 2's space). Re-fitted on the
     * labelled libraries (H3).
     */
    minDistance: 0.08,
    /** What a flash-shaped peak (the next frame changes back) needs to count as a cut. */
    confirmDistance: 0.25,
    /** The frame after a peak changes at least this share of the peak's MAFD: flash-shaped. */
    flashMafdRatio: 0.5,
    /** A candidate is located to the frame within this window on each side. */
    locateMs: 150,
    /** Shorter shots merge into their neighbour. */
    minShotMs: 500,
    /** TransNetV2 (IX2-C4) and its own process (IX2-S2): cuts/model-config.ts. */
    model: SHOT_MODEL_CONFIG,
  },
  cuts: {
    longSide: 256,
    proposeScore: 5,
    confirmScore: 25,
    confirmDistance: 0.2,
    rejectDistance: 0.08,
    softScanFps: 2,
    /** The Minimum tier embeds slower: the soft-cut scan drops to this. */
    softScanFpsMinimum: 1,
    softDistance: 0.25,
    softConfirmDistance: 0.35,
    /** No model to break a tie: a disputed hard cut stays at this score, marked unverified. */
    unverifiedKeepScore: 12,
    /** Frames around a cut that are embedded: 2 before, 1 after (the cut frame is the first of the new shot). */
    before: 2,
    after: 1,
  },
  strip: {
    /** Offsets of the frames shown per disputed candidate. */
    offsets: [-2, -1, 0, 1, 2],
    tileLongSide: 256,
    perSheet: 6,
  },
  ocr: {
    /**
     * The `vision.ocr` stage's own version (stage-frames.ts `visionStageVersions`; it was added to the shots' and
     * the analysis's until IX3-I3): raise it when what the stage stores changes, and every asset's text is read
     * again. New shots or best frames re-read it through `vision.ocr`'s reads.
     */
    version: 1,
    minConfidence: 0.3,
    minChars: 2,
    trackIou: 0.5,
    trackSimilarity: 0.8,
    /** A track closes after this many samples without it. */
    closeAfterMissing: 2,
    refineCallsPerEdge: 3,
    /** Mean absolute difference of the 64×64 thumbnail below which a frame reuses the last OCR result. */
    unchangedMad: 2 / 255,
    thumbSize: 64,
    mergeIou: 0.5,
    /** A Vision observation under this confidence over a Devanagari box is Vision misreading Hindi. */
    visionGarbageConfidence: 0.5,
    /**
     * Text whose letters and digits are at least this share digits is a counter (clock, timer, score): it stays
     * one track while its digits change in place (IX-O4, counter-text.ts).
     */
    counterDigitShare: 0.5,
    /** Two counter readings are one counter when one box holds this much of the other (a partial read). */
    counterContainment: 0.8,
    /**
     * Counter readings side by side on one line are pieces of one counter when at most this many of their
     * characters apart (FIX-CLOCK, counter-pieces.ts): macOS 27.2's Vision reads a clock as two or three.
     */
    counterPieceGap: 4,
    /** Pieces share a line when they overlap down by this share of the shorter one's height... */
    counterPieceLine: 0.5,
    /** ...and are within this ratio of each other's height. */
    counterPieceHeights: 1.5,
    /**
     * A reading is kept when at least this share of its letters and digits are Latin, ASCII digits, or a script
     * an asked language writes (IX-O4, plausible.ts): texture read as Han or Arabic-Indic digits is dropped.
     */
    plausibleScriptShare: 0.5,
  },
  quality: {
    fps: 10,
    longSide: 256,
    shiftSize: 64,
    /** Phase-correlation peak below which a shift is not trusted (flat frames, noise, cuts). */
    minShiftPeak: 0.08,
    /** Laplacian variance (gray 0–255, at 256 px) that scores 0.5 sharpness. Re-fitted on G25 fixtures. */
    sharpnessMid: 60,
    /** Stability: high-pass RMS shift as a fraction of the width that scores 0.5. */
    shakeMid: 0.01,
    darkMean: 40,
    brightMean: 215,
    clipFraction: 0.25,
    flatVariance: 4,
    blurryBelow: 0.3,
    shakyBelow: 0.4,
    /** Weights of the overall score. */
    weights: { sharpness: 0.45, exposure: 0.3, stability: 0.25 },
    /** Low-pass motion (fraction of the width per second) that counts as a pan or tilt. */
    panSpeed: 0.05,
  },
  /**
   * What casting reads per shot beyond the analysis (core's ShotProfile; timeline SPEC "Requests"):
   * 100 ms motion and sharpness curves and full-rate motion peaks, from the analysis pass. Starting
   * points from the casting research note, tuned on P2-Q2. Bump `version` with any change: it is part
   * of the analyse job's key and raises the `vision.analyse` stage's version (no other: the stages that read the
   * analysis follow only when the best frames or the text reader it stores change).
   */
  profile: {
    /** 2: the curves and peaks travel in the analysis (`ShotAnalysis.signals`). */
    version: 2,
    sampleMs: 100,
    /** Change (mean absolute difference of 64×64 thumbnails, 0–255, per 100 ms) that scores 1. */
    changeScale: 25,
    /** A full-rate local motion maximum (3-frame ring) at or above this is a peak (research PEAK_MIN). */
    peakMin: 0.55,
    /** Longer shots keep no curves (an hour at 100 ms); peaks are capped to the strongest. */
    maxCurveSamples: 36_000,
    maxPeaks: 400,
  },
  duplicates: {
    windowMs: 10 * 60_000,
    /** dHash Hamming distance (of 64 bits) that agrees, with `cosine`. */
    hamming: 10,
    /** Without stored vectors (the index can't read them back yet): dHash alone, stricter. */
    hashOnly: 6,
    /**
     * Cosine similarities of two shots' best-frame vectors, by the image-token budget they were embedded at
     * (IX2-E2, analysis/duplicates.ts): `cosine` with an agreeing dHash, `cosineAlone` on its own,
     * `cosineWithSameHash` with a near-identical dHash (≤ hashOnly: the same moment taken worse; a blurred twin
     * of a synthetic burst measured 0.86 at 280 against 0.98–0.99 for the sharp takes and 0.70–0.79 for other
     * shots). 280 is the original G25 fit; 140 and 70 are 280's moved by how much each budget shrinks the
     * distance between two frames (×0.889 and ×0.830), measured on a generated labelled set of 494 pairs
     * (scripts/study-duplicates.ts, vision SPEC "Duplicate thresholds per budget"): F1 0.992 at 280, 0.993 at 140,
     * 0.990 at 70, recall 1 at each. To be re-fitted on the G25 phone bursts (H3).
     */
    similarity: {
      280: { cosine: 0.92, cosineAlone: 0.96, cosineWithSameHash: 0.85 },
      140: { cosine: 0.929, cosineAlone: 0.964, cosineWithSameHash: 0.867 },
      70: { cosine: 0.934, cosineAlone: 0.967, cosineWithSameHash: 0.876 },
    },
  },
  describe: {
    longSide: 768,
    maxTokens: 400,
  },
  breakdown: {
    ocrFps: 4,
    ocrLongSide: 1280,
    sheet: { columns: 4, tileLongSide: 180, maxBytes: 600 * 1024, maxTiles: 60 },
  },
} as const;

export type VisionConfig = typeof VISION_CONFIG;

/** Hardware tiers (PRD G14), as the component manifest names them. */
export const TIERS = ['minimum', 'recommended', 'high'] as const;
export type Tier = (typeof TIERS)[number];
