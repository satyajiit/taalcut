// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The mac helper's `track.shot` client (native/mac-helper/SPEC.md, service `track`; render SPEC P3.2): one
 * shot's face, human and saliency boxes at 4 fps with tracker samples between, as core's SubjectTrack. The
 * helper's reply is untrusted input: zod-validated, boxes converted once from Vision's lower-left space to
 * core's top-left NormalisedBox and clamped into the frame, missing arrays read as empty. Boxes only: no
 * landmarks, no identity (vision SPEC P3.4).
 */
import { z } from 'zod';
import {
  err,
  ok,
  RationalTime,
  SUBJECT_COMPUTE,
  SUBJECT_KINDS,
  subjectTrackSchema,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type SubjectTrack,
  type TimeRange,
} from '@taalcut/core';
import type { JsonValue } from '@taalcut/media';

/** What the client needs of the helper process: media's JsonLineSidecar fits. */
export interface HelperRequester {
  request(
    method: string,
    params: JsonValue,
    options?: {
      readonly signal?: AbortSignal;
      readonly timeoutMs?: number;
      readonly settleOnReply?: boolean;
      readonly onLetGo?: () => void;
      readonly onSend?: (pid: number) => void;
    },
  ): AsyncResult<unknown>;
}

/** The detection recipe this client asks for; a change re-tracks (it is part of the cache key). */
export const TRACK_RECIPE = {
  faceRevision: 3,
  humanRevision: 2,
  saliencyRevision: 2,
  trackerRevision: 2,
  detectHz: 4,
  trackHz: 12,
  shortSide: 480,
  // FRM1: whole heads (faces widened by measured proportions, upper bodies' and body poses' heads; 2 added the
  // poses) and the silhouette.
  headRevision: 2,
  silhouetteRevision: 1,
  detector: 'vision',
} as const;

/**
 * The recipe of tracks made without the mac helper (FRM1-SUB, Linux and Windows): vision's ONNX detector (RTMO-s
 * poses and YOLOX-Nano people) at the same rate and size, detect samples only, no silhouette. Its own cache key.
 */
export const ONNX_TRACK_RECIPE = {
  faceRevision: 1,
  humanRevision: 1,
  saliencyRevision: 1,
  trackerRevision: 1,
  detectHz: 4,
  trackHz: 0,
  shortSide: 480,
  headRevision: 1,
  detector: 'onnx',
} as const;

/** A shot of up to 10 minutes at about real time, with room to spare. */
const TRACK_TIMEOUT_MS = 15 * 60_000;

const boxJson = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const scoredJson = z.object({ box: boxJson, confidence: z.number() });
const faceJson = scoredJson.extend({
  roll: z.number().default(0),
  yaw: z.number().default(0),
  pitch: z.number().default(0),
});
const timeJson = z.object({ value: z.number(), rate: z.number().positive() });
const silhouetteJson = z.object({ cols: z.int(), rows: z.int(), bits: z.string() });
const sampleJson = z.object({
  t: timeJson,
  source: z.enum(['detect', 'track']),
  faces: z.array(faceJson).default([]),
  humans: z.array(scoredJson).default([]),
  saliency: z.array(scoredJson).default([]),
  // FRM1: on detect samples from a helper that finds heads; absent from an older helper.
  heads: z.array(scoredJson).optional(),
  people: z.array(scoredJson).optional(),
  silhouette: silhouetteJson.optional(),
  subject: z.object({
    kind: z.enum(SUBJECT_KINDS),
    box: boxJson.nullable().optional(),
    focus: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
    confidence: z.number(),
  }),
});
const resultJson = z.object({
  boxSpace: z.literal('normalized-lower-left'),
  /** The decoded upright frame's size (the boxes' frame). */
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  compute: z.record(z.string(), z.string()).default({}),
  samples: z.array(sampleJson).max(20_000),
});

const unit = (value: number) => Math.min(1, Math.max(0, value));

/** Vision's lower-left box → core's top-left box, cut to the part inside the frame. */
export function topLeftBox(box: z.output<typeof boxJson>): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const x0 = unit(box.x);
  const x1 = unit(box.x + box.width);
  const y0 = unit(1 - box.y - box.height);
  const y1 = unit(1 - box.y);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

const scored = (entry: z.output<typeof scoredJson>) => ({
  box: topLeftBox(entry.box),
  confidence: unit(entry.confidence),
});

const COMPUTE_PARTS = ['faces', 'humans', 'saliency', 'track', 'silhouette'] as const;
type ComputePart = (typeof COMPUTE_PARTS)[number];
const computeOf = (value: string | undefined) =>
  SUBJECT_COMPUTE.find((device) => device === value) ?? 'unknown';

export interface TrackShotInput {
  readonly assetId: AssetId;
  /** The asset's content hash (the library's BLAKE3). */
  readonly contentHash: string;
  /** The original (or a proxy) inside a root the helper allows. */
  readonly path: string;
  /** The shot, at the asset's rate. */
  readonly range: TimeRange;
  readonly signal?: AbortSignal;
  /**
   * Called once when the helper has let go of the request, with its answer or its exit, or at once when no request
   * went out: its decode (a video session) ends there, not when `track` returns. A cancel or a timeout returns first
   * (IX3-F5, H6).
   */
  readonly onLetGo?: () => void;
  /** The helper's pid, just before the request goes to it: the job's lease records it first (IX3-F7). */
  readonly onSend?: (pid: number) => void;
}

export interface TrackShotResult {
  readonly track: SubjectTrack;
  /** Requests that ran on the CPU: the caller reports compute.fallback for them (ADR 0002). */
  readonly cpu: readonly ComputePart[];
}

/** RationalTime at a fractional rate as the helper's CMTime-like {value, timescale}. */
const helperTime = (time: RationalTime) => ({ value: time.value * time.rate.den, rate: time.rate.num });

export interface SubjectTracker {
  track(input: TrackShotInput): AsyncResult<TrackShotResult>;
}

/**
 * `trackHz: 0` detects only (the reel's subjects, FRM1-SUB): no samples between detections. The track's recipe says
 * so, so it never stands in for a full one.
 */
export function createSubjectTracker(
  helper: HelperRequester,
  options: { readonly trackHz?: number } = {},
): SubjectTracker {
  const recipe = { ...TRACK_RECIPE, trackHz: options.trackHz ?? TRACK_RECIPE.trackHz };
  return {
    async track(input) {
      const end = RationalTime.add(input.range.start, input.range.duration);
      const reply = await helper.request(
        'track.shot',
        {
          path: input.path,
          start: helperTime(input.range.start),
          end: helperTime(end),
          detectHz: recipe.detectHz,
          trackHz: recipe.trackHz,
          shortSide: recipe.shortSide,
        },
        {
          ...(input.signal ? { signal: input.signal } : {}),
          timeoutMs: TRACK_TIMEOUT_MS,
          // A cancel waits for the helper's answer (within media's grace), as decode does (IX3-F5, H6).
          settleOnReply: true,
          ...(input.onLetGo ? { onLetGo: input.onLetGo } : {}),
          ...(input.onSend ? { onSend: input.onSend } : {}),
        },
      );
      if (!reply.ok) return reply;
      const parsed = resultJson.safeParse(reply.value);
      if (!parsed.success)
        return err(ValidationError({ field: 'track.shot' }, { detail: parsed.error.message }));
      const rate = input.range.start.rate;
      const samples = parsed.data.samples.map((sample) => {
        const kind = sample.subject.kind;
        const box = kind === 'none' || !sample.subject.box ? null : topLeftBox(sample.subject.box);
        const focus =
          kind === 'none' || !sample.subject.focus
            ? null
            : { x: unit(sample.subject.focus.x), y: unit(1 - sample.subject.focus.y) };
        return {
          t: RationalTime.fromSeconds(sample.t.value / sample.t.rate, rate),
          source: sample.source,
          faces: sample.faces
            .slice(0, 16)
            .map((face) => ({ ...scored(face), roll: face.roll, yaw: face.yaw, pitch: face.pitch })),
          humans: sample.humans.slice(0, 16).map(scored),
          saliency: sample.saliency.slice(0, 8).map(scored),
          ...(sample.heads ? { heads: sample.heads.slice(0, 16).map(scored) } : {}),
          ...(sample.people ? { people: sample.people.slice(0, 16).map(scored) } : {}),
          // The grid is already top-left and row-major; the schema below refuses one whose bits don't fill it.
          ...(sample.silhouette ? { silhouette: sample.silhouette } : {}),
          subject: { kind, box, focus, confidence: unit(sample.subject.confidence) },
        };
      });
      const compute: Partial<Record<ComputePart, (typeof SUBJECT_COMPUTE)[number]>> = {};
      for (const part of COMPUTE_PARTS)
        if (parsed.data.compute[part] !== undefined) compute[part] = computeOf(parsed.data.compute[part]);
      const track = subjectTrackSchema.safeParse({
        version: 1,
        assetId: input.assetId,
        contentHash: input.contentHash,
        range: input.range,
        recipe,
        ...(parsed.data.width && parsed.data.height
          ? { frame: { width: parsed.data.width, height: parsed.data.height } }
          : {}),
        compute,
        samples,
      });
      if (!track.success)
        return err(ValidationError({ field: 'track.shot' }, { detail: track.error.message }));
      return ok({ track: track.data, cpu: COMPUTE_PARTS.filter((part) => compute[part] === 'cpu') });
    },
  };
}
