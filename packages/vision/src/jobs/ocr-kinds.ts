// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The on-screen text kind (IX-O5): `vision.readShotText`, what the
 * `vision.ocr` stage enqueues. Apple Vision's recogniser runs on the Neural
 * Engine inside the mac helper (PP-OCR on ONNX Runtime elsewhere), so the kind
 * is in the `npu` class on its own `vision.ocr` lane: it overlaps the
 * embedder, whisper and the video work instead of waiting behind them.
 */
import { defineJobKind, onScreenTextSchema } from '@taalcut/core';
import { z } from 'zod';
import { DEFAULT_RECOGNITION } from '../ocr/apple-vision';
import { ocrCountsSchema } from '../ocr/meter';
import { VISION_CONFIG } from '../config';
import { decodes, framed, MINUTE, retry, shotRef, visionKey } from './index-kinds';

export const visionReadShotTextJob = defineJobKind({
  kind: 'vision.readShotText',
  input: z.object({
    ...framed,
    /** The asset's source: the metadata of the on-screen-text vectors a run with no engine keeps (IX2-F12). */
    sourceId: z.string().min(1).max(64).optional(),
    shots: z
      .array(
        shotRef.extend({
          /** The analysis's best frame, relative to the shot's first frame. */
          bestFrame: z.int().nonnegative().optional(),
          /** The text tracks stored on the shot (its `ocr:<shotId>:<n>` vectors), kept with no engine (IX2-F12). */
          textTracks: z.int().positive().max(10_000).optional(),
        }),
      )
      .min(1)
      .max(20_000),
    /** The spoken language first, then the app's; the engine reads those it serves. */
    languages: z.array(z.string().min(2).max(35)).max(8),
  }),
  output: z.object({
    shots: z
      .array(
        z.object({ shotId: z.string().min(1).max(64), onScreenText: z.array(onScreenTextSchema).max(200) }),
      )
      .max(20_000),
    /** What the read did (meter.ts), for the bench. */
    ocr: ocrCountsSchema,
    ...decodes,
  }),
  resource: 'npu',
  lane: 'vision.ocr',
  priority: 'normal',
  retry: retry(2),
  timeoutMs: 60 * MINUTE,
  idempotencyKey: (input) =>
    visionKey(
      'vision.readShotText',
      input,
      JSON.stringify([
        input.shots.map((s) => [s.shotId, s.bestFrame ?? null]),
        input.languages,
        `ocr-v${VISION_CONFIG.ocr.version}`,
        DEFAULT_RECOGNITION,
        VISION_CONFIG.breakdown.ocrLongSide,
      ]),
    ),
});

export type ReadShotTextInput = z.output<typeof visionReadShotTextJob.input>;

export const ocrJobKinds = [visionReadShotTextJob] as const;
