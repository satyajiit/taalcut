// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Subject tracks (P3-V2, with P3-V9's punch-ins): where the subject is in a shot, sampled over time, so reframing
 * keeps it in the crop. Render's `render.trackSubjects` job writes one as derived JSON (DERIVED_KINDS
 * 'subjectTrack'); render, the agent and jobs read it. Boxes only: strict objects, no landmarks, no vectors and
 * no identity across shots (vision SPEC P3.4's guard test reads this schema).
 *
 * FRM1-SUB adds, on detect samples, whole-head boxes (the hard keep-out for graphics), whole-person boxes and a
 * coarse person silhouette (a soft keep-out), and the frame size the boxes are fractions of. All are optional, so
 * tracks made before them still parse; the recipe's `headRevision` is part of the cache key, so they re-track.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { derivedFileRefSchema } from '../analysis/media-facts';
import { idSchema, type AssetId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { boxSchema } from '../templates/template-parts';
import { rationalTimeSchema } from '../time/rational-time';
import { timeRangeSchema, type TimeRange } from '../time/time-range';

const score = z.number().min(0).max(1);
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const scored = z.object({ box: boxSchema, confidence: score }).strict();

export const SUBJECT_KINDS = ['face', 'human', 'union', 'saliency', 'track', 'none'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];
export const SUBJECT_COMPUTE = ['neuralEngine', 'gpu', 'cpu', 'unknown'] as const;
/** What detected the boxes: Apple Vision through the mac helper, or the on-device ONNX detector (no helper). */
export const SUBJECT_DETECTORS = ['vision', 'onnx'] as const;
export type SubjectDetector = (typeof SUBJECT_DETECTORS)[number];

/** The largest silhouette grid side: 64 × 64 cells is 512 bytes, 684 base64 characters. */
export const SILHOUETTE_MAX_SIDE = 64;
const base64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * A coarse person-occupancy grid over the upright frame: `cols` × `rows` equal cells from the top left, row-major,
 * one bit per cell, most significant bit first, base64. A cell is set when people cover at least a quarter of it.
 * Read it with `silhouetteCell` (silhouette.ts).
 */
export const silhouetteSchema = z
  .object({
    cols: z.int().min(1).max(SILHOUETTE_MAX_SIDE),
    rows: z.int().min(1).max(SILHOUETTE_MAX_SIDE),
    bits: z.string().max(700).regex(base64),
  })
  .strict()
  .refine((grid) => grid.bits.length === 4 * Math.ceil(Math.ceil((grid.cols * grid.rows) / 8) / 3), {
    message: 'The bits do not fill the grid',
  });
export type Silhouette = z.output<typeof silhouetteSchema>;

export const subjectSampleSchema = z
  .object({
    /** Source time at the asset's rate. */
    t: rationalTimeSchema,
    source: z.enum(['detect', 'track']),
    /** Boxes in the upright frame, origin top left. */
    faces: z
      .array(
        z
          .object({ box: boxSchema, confidence: score, roll: z.number(), yaw: z.number(), pitch: z.number() })
          .strict(),
      )
      .max(16),
    humans: z.array(scored).max(16),
    saliency: z.array(scored).max(8),
    /**
     * FRM1: each person's whole head, hair included, also when it is seen from the side or behind. The hard
     * keep-out for graphics. Detect samples only; absent on track samples and on tracks made before FRM1.
     */
    heads: z.array(scored).max(16).optional(),
    /** FRM1: each person's whole visible body (the human rectangles, widened to the head and silhouette). */
    people: z.array(scored).max(16).optional(),
    /** FRM1: where people are, coarsely (a soft keep-out). Absent when segmentation didn't run. */
    silhouette: silhouetteSchema.optional(),
    subject: z
      .object({
        kind: z.enum(SUBJECT_KINDS),
        box: boxSchema.nullable(),
        focus: point.nullable(),
        confidence: score,
      })
      .strict(),
  })
  .strict();
export type SubjectSample = z.output<typeof subjectSampleSchema>;

export const subjectTrackSchema = z
  .object({
    version: z.literal(1),
    assetId: idSchema<'Asset'>(),
    contentHash: z.string().min(1).max(128),
    /** The shot's range at the asset's rate. */
    range: timeRangeSchema,
    /** The helper's recipe, so a change re-tracks. */
    recipe: z
      .object({
        faceRevision: z.int().positive(),
        humanRevision: z.int().positive(),
        saliencyRevision: z.int().positive(),
        trackerRevision: z.int().positive(),
        detectHz: z.number().positive(),
        trackHz: z.number().nonnegative(),
        shortSide: z.int().positive(),
        /** FRM1: how heads are found from faces, bodies and the silhouette; absent before FRM1. */
        headRevision: z.int().positive().optional(),
        /** FRM1: the person segmentation's revision; absent when none ran. */
        silhouetteRevision: z.int().positive().optional(),
        /** FRM1: what detected the boxes; absent is the mac helper's Vision. */
        detector: z.enum(SUBJECT_DETECTORS).optional(),
      })
      .strict(),
    /** FRM1: the upright frame the boxes are fractions of, in the detector's pixels (its aspect is the source's). */
    frame: z.object({ width: z.int().positive(), height: z.int().positive() }).strict().optional(),
    /** What ran where, for compute.fallback reporting. */
    compute: z.partialRecord(
      z.enum(['faces', 'humans', 'saliency', 'track', 'silhouette']),
      z.enum(SUBJECT_COMPUTE),
    ),
    samples: z.array(subjectSampleSchema).max(20_000),
  })
  .strict();
export type SubjectTrack = z.output<typeof subjectTrackSchema>;

export interface SubjectTrackReader {
  /** The track covering this range of the asset, or null when none was made (nothing is started). */
  get(assetId: AssetId, range: TimeRange, signal?: AbortSignal): AsyncResult<SubjectTrack | null>;
}
export const SubjectTrackReaderToken = createToken<SubjectTrackReader>('core.subjectTrackReader');

export const SUBJECT_TRACK_JOB_KIND = 'render.trackSubjects';
export const trackSubjectsJobInputSchema = z.object({ assetId: idSchema<'Asset'>(), range: timeRangeSchema });
/** The track in the media cache (DERIVED_KINDS 'subjectTrack'). */
export const trackSubjectsJobOutputSchema = z.object({ track: derivedFileRefSchema });
