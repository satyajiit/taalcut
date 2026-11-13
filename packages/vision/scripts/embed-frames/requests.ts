// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The frames `vision.embed` asked for, per asset, as an indexing bench stored them (IX2-G1): every
 * succeeded `vision.embedAsset` job of a bench run's library, with the plan normalise passed it. The
 * bench keeps the library (`~/TaalcutBench/runs/<name>/run-1/index-library.sqlite`), so the frames are
 * exactly the ones the stage read on that tree, shots and best frames included.
 */
import { DatabaseSync } from 'node:sqlite';
import { basename } from 'node:path';
import type { NormalisationPlan } from '@taalcut/media';
import { z } from 'zod';

export interface EmbedRequest {
  readonly file: string;
  readonly path: string;
  readonly plan: NormalisationPlan;
  /** Grid frames, in the job's order (per shot, best frame first). */
  readonly frames: readonly number[];
  /** The bench's own count of FFmpeg runs for the job (its `decodes`). */
  readonly benchFfmpeg: number;
  /** The job's wall time in the bench (lease waits and the model included). */
  readonly benchMs: number;
}

const payloadSchema = z.object({
  path: z.string(),
  plan: z.custom<NormalisationPlan>((value) => typeof value === 'object' && value !== null),
  frames: z.array(z.object({ shotId: z.string(), frames: z.array(z.int().nonnegative()) })),
});
const resultSchema = z.object({ decodes: z.object({ ffmpeg: z.int().nonnegative() }).optional() });
const rowSchema = z.object({
  payload: z.string(),
  result: z.string().nullable(),
  started_at: z.number().nullable(),
  finished_at: z.number().nullable(),
});

export function readEmbedRequests(library: string): EmbedRequest[] {
  const db = new DatabaseSync(library, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT payload, result, started_at, finished_at FROM jobs WHERE kind = 'vision.embedAsset' AND state = 'succeeded' ORDER BY started_at",
      )
      .all();
    return rows.map((raw) => {
      const row = rowSchema.parse(raw);
      const payload = payloadSchema.parse(JSON.parse(row.payload));
      const result = resultSchema.parse(row.result ? JSON.parse(row.result) : {});
      return {
        file: basename(payload.path),
        path: payload.path,
        plan: payload.plan,
        frames: payload.frames.flatMap((shot) => shot.frames),
        benchFfmpeg: result.decodes?.ffmpeg ?? 0,
        benchMs: (row.finished_at ?? 0) - (row.started_at ?? 0),
      };
    });
  } finally {
    db.close();
  }
}
