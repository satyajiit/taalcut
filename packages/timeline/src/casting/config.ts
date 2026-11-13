// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The casting config (SPEC, "Weights"): every weight, threshold and constant
 * the engine uses, versioned. P2-Q2 tunes it and writes the next version;
 * weights edited in code fail review. The plan fixes beam width 8, 50
 * candidates, 3 alternates, 5 reranked, 10 variants, the 30% difference, the
 * ±1 frame beat tolerance and the 100 ms curves, so the schema pins them.
 */
import { CAMERA_MOTIONS } from '@taalcut/core';
import { z } from 'zod';
import raw from '../../config/casting.v5.json';

const unit = z.number().min(0).max(1);
const weight = z.number().min(0).max(5);
const byMotion = <T extends z.ZodType>(value: T) => z.record(z.enum(CAMERA_MOTIONS), value);

export const castingConfigSchema = z.object({
  version: z.string().regex(/^casting\.v[1-9]\d*$/),
  note: z.string().max(500).optional(),
  candidates: z.object({
    k: z.literal(50),
    qualityFloor: unit,
    relaxedConfidenceCap: unit,
    /** Story order: most shots read for one brief. */
    storyPoolLimit: z.int().min(1).max(5000),
    /** A vector index without shot filters reads this many times k, then filters. */
    vectorOverfetch: z.int().min(1).max(80),
  }),
  weights: z.object({ intent: weight, motion: weight, quality: weight, subject: weight, energy: weight }),
  /** What a part scores when the slot or the shot says nothing. */
  neutral: z.object({ intent: unit, motion: unit, subject: unit }),
  /**
   * FIX-CAST: the intent part. The cosine of a slot's line to a shot sits in a narrow band (0.6 to 0.78 in the
   * EmbeddingGemma space), so it is rescaled from its floor (0) to its ceiling (1), then blended with the attributes
   * a person picks by (attributes.ts), each with its weight against the cosine's.
   */
  intentMatch: z.object({
    cosineFloor: z.number().min(-1).max(1),
    cosineCeiling: z.number().min(-1).max(1),
    weights: z.object({ cosine: weight, light: weight, facing: weight, setting: weight, shotType: weight }),
    /** A shot one size off the slot's (wide for medium). */
    nextSize: unit,
    /** The intent part is multiplied by this when night meets day or facing away meets facing the camera, */
    conflict: unit,
    /** and the shot's score loses this, so a same-place neighbour never outweighs it. */
    conflictPenalty: weight,
  }),
  /**
   * FIX-STORY: the distinctive things a slot asks for (terms.ts), blended into the intent part beside the
   * cosine and the attributes. A word counts by its rarity among the shots casting weighs: IDF on 0..1, to the
   * power `sharpness`.
   */
  terms: z.object({
    /** The match's weight against the cosine's when the slot names a word only one shot shows. */
    weight,
    sharpness: z.number().min(1).max(4),
    /**
     * FIX-HOOK: what a shot loses for each of its slot's needs (SlotIntent.needs, needs.ts) it doesn't meet, when a
     * shot the slot could take does. A unary score spans about -0.3 to 1.3 and a night-for-day conflict costs about
     * 0.5, so 3 is more than any trade of the shot to another slot with a conflict on top: the slot gets the shot
     * that meets it. Every shot without it loses the same, so their order stays as it was.
     */
    requiredPenalty: weight,
    /**
     * FIX-HOOK: how far above the slot pool's median cosine a shot must sit to the need's phrase to meet it by
     * meaning (a synonym), when its description doesn't name the need's things.
     */
    needMargin: unit,
  }),
  motion: z.object({
    sameClass: unit,
    sameFamily: unit,
    families: byMotion(z.string().min(1)),
    /** Shot energy when no measured energy exists. */
    energy: byMotion(unit),
  }),
  subject: z.object({ facesWhenNoneWanted: unit, tagWeight: unit }),
  /** The slot's energy is raised by its beat density above this many beats per second. */
  energy: z.object({ beatsPerSecondBase: z.number().min(0), gainPerBeatPerSecond: z.number().min(0) }),
  penalties: z.object({
    nearDuplicateCosine: unit,
    nearDuplicate: weight,
    sameAsset: weight,
    samePlace: weight,
  }),
  hook: z.object({
    weight,
    motion: unit,
    face: unit,
    novelty: unit,
    sharpness: unit,
    /** FIX-STORY: on the opening, what the slot names (words and graphics) that the shot shows (terms.ts). */
    story: unit,
    recentShots: z.int().min(0).max(100),
    openingSeconds: z.number().positive().max(10),
    openingWeight: weight,
  }),
  beam: z.object({ width: z.literal(8) }),
  inPoint: z.object({
    sampleMs: z.literal(100),
    beatToleranceFrames: z.literal(1),
    /**
     * FIX-TRIM: the action under way (settle.ts). The onset ends where motion first holds `steadyFraction` of its
     * steady level (the median over the shot's middle half) for `steadySamples` samples in a row; a shot whose steady
     * level is under `minSteady` has none. Onset and stop last at most `maxSeconds` each. A window loses up to
     * `onsetWeight` for starting inside the onset and `stopWeight` for running into the stop; an aligned window must
     * be within `alignSlack` of the most settled window's penalty to win.
     */
    settle: z.object({
      steadyFraction: unit,
      steadySamples: z.int().min(1).max(10),
      minSteady: unit,
      maxSeconds: z.number().positive().max(5),
      onsetWeight: weight,
      stopWeight: weight,
      alignSlack: weight,
    }),
    /** FIX-TRIM: a window gains up to this as its middle nears vision's best frame (the shot's length away: 0). */
    bestFrameWeight: weight,
    /**
     * FIX-TRIM: the recording's own ends (recording.ts). A phone recording's first `startSeconds` is the person and
     * whoever films getting going, its last `endSeconds` reaching to stop. A window loses up to `startWeight` for the
     * share of it inside the first, `endWeight` inside the last: the file's ends, not the shot's.
     */
    recording: z.object({
      startSeconds: z.number().min(0).max(5),
      endSeconds: z.number().min(0).max(5),
      startWeight: weight,
      endWeight: weight,
    }),
    /**
     * FIX-TRIM: timeline.slipClip's `avoid` (slip-point.ts). The windows with the least of what to avoid are the
     * choice, each losing `nearWeight` a shot's length away from the clip's part. When nothing measured
     * shows what the person named, the clip moves `stepSeconds` or more that way. The shot is tracked for faces and
     * the person for at most `trackMs`.
     */
    slip: z.object({
      stepSeconds: z.number().positive().max(10),
      nearWeight: weight,
      trackMs: z.int().min(0).max(60_000),
    }),
    /**
     * FIX-TRIM: the person (subject-motion.ts, subject-terms.ts), from the subject tracks of a cast clip's shot. The
     * main person is under way at `movingSpeed` box heights a second or more (a centred median over `smoothSamples`)
     * held for `steadySeconds`; a gap over `maxGapSeconds` between sightings, or a box more than `sizeRatio` bigger or
     * smaller than the last, starts afresh. A slot is motion when
     * the reel's person moves for `reelMovingShare` of it, else by its words, camera motion or energy. Weights: the
     * share of a window before the person is under way (or after they stop) on a moving slot, a start or stop inside
     * the window on another, and the share of moments showing a face (at least `minFaceHeight` of the frame) when the
     * slot shows none. Assembly tracks each pick's shot `searchSeconds` either side of the pick.
     */
    subjects: z.object({
      movingSpeed: z.number().positive().max(10),
      smoothSamples: z.int().min(1).max(15),
      steadySeconds: z.number().positive().max(5),
      maxGapSeconds: z.number().positive().max(5),
      sizeRatio: z.number().min(1).max(4),
      /** A window should start this long after the person's first step, and end this long before they are still. */
      marginSeconds: z.number().min(0).max(3),
      minConfidence: unit,
      minFaceHeight: unit,
      reelMovingShare: unit,
      movingWords: z.array(z.string().min(1).max(30)).max(60),
      movingMotions: z.array(z.enum(CAMERA_MOTIONS)).max(CAMERA_MOTIONS.length),
      movingEnergy: unit,
      onsetWeight: weight,
      straddleWeight: weight,
      faceWeight: weight,
      /** A clip already cast moves only when the person's terms improve by at least this. */
      minGain: weight,
      searchSeconds: z.number().min(0).max(30),
    }),
  }),
  /**
   * FIX-CAST: confidence is the margin over the first alternate, and never more than the fit says: none at an intent
   * part of `poorFit` or less, the margin alone from `goodFit`, a straight line between.
   */
  confidence: z.object({
    tau: z.number().positive(),
    rerankBelow: unit,
    alternates: z.literal(3),
    poorFit: unit,
    goodFit: unit,
  }),
  rerank: z.object({ count: z.literal(5), weight }),
  variants: z.object({
    max: z.literal(10),
    minDifference: z.literal(0.3),
    reusePenalty: weight,
    retries: z.int().min(0).max(10),
  }),
  /** Target energy with no format energy: base + amplitude · sin(π · i / (n − 1)). */
  story: z.object({ energyBase: unit, energyAmplitude: unit }),
  /** Scores closer than this are a tie (broken by the lower shot id). */
  tieEpsilon: z.number().positive().max(1e-3),
});

export type CastingConfig = z.output<typeof castingConfigSchema>;

/** config/casting.v5.json, validated at load. */
export const CASTING_CONFIG: CastingConfig = castingConfigSchema.parse(raw);
