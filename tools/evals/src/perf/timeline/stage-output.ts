// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Counters other lanes' stage jobs report in their output (`asset_index_stages.output`), read by the timeline:
 * `decodes` (the decode lane, specs/requests-decode-to-bench.md) and `ocr` (the ocr lane,
 * specs/requests-ocr-to-bench.md). Each is checked against the agreed shape; one in another shape is counted as
 * unreadable and left out, so a renamed field shows in the report instead of failing the run's analysis.
 */
import { z } from 'zod';

const count = z.number().nonnegative();

export const decodeCountsSchema = z.looseObject({
  ffmpeg: count,
  ffprobe: count,
  fullDecodes: count,
  partialDecodes: count,
  originalFullDecodes: count,
});
export type DecodeCounts = z.output<typeof decodeCountsSchema>;

/** packages/vision/src/ocr/meter.ts's ocrCountsSchema: the fields the bench reports. */
export const ocrCountsSchema = z.looseObject({
  sampled: count.optional(),
  reused: count.optional(),
  requests: count,
  frames: count,
  refineCalls: count,
  refineDecodes: count,
  ms: z.looseObject({ engine: count }),
});
export type OcrCounts = z.output<typeof ocrCountsSchema>;

export interface OutputField<T> {
  readonly value: T | null;
  /** The field is there in another shape. */
  readonly unreadable: boolean;
}

/** `json`: the field as SQLite's json_extract gives it (JSON text for an object), null when absent. */
export function outputField<T>(json: string | number | null, schema: z.ZodType<T>): OutputField<T> {
  if (json === null) return { value: null, unreadable: false };
  let value: unknown = json;
  if (typeof json === 'string')
    try {
      value = JSON.parse(json);
    } catch {
      value = null;
    }
  const parsed = schema.safeParse(value);
  return parsed.success ? { value: parsed.data, unreadable: false } : { value: null, unreadable: true };
}
