// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How one engine call's frames are cut into helper requests (IX3-O1 study), as wrappers over an Apple Vision
 * engine that sends one request per call (`inFlight: 1`), so rules can be compared in one run:
 * - `fill-16`: today's rule (`apple-vision.ts`): requests of 16 in frame order, two in flight. A call of 13
 *   frames is one request, so one of the helper's two slots idles; 45 frames run 16 ‖ 16, then 13 alone.
 * - `fill-8`: the same with requests of 8 (IX-O6 measured it once: 60.6 ms a frame against 65–69).
 * - `even`: as many requests as 16-frame ones would need, rounded up to a multiple of the requests in flight,
 *   sizes as equal as possible: 13 frames are 7 ‖ 6, 45 are 12 ‖ 11 then 11 ‖ 11.
 * - `engine`: no wrapper; whatever `apple-vision.ts` of the code under study does (two in flight).
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { inFlight } from '../../src/ocr/in-flight';
import type { OcrEngine, OcrPage } from '../../src/ocr/types';

export const BATCH_RULES = ['fill-16', 'fill-8', 'even', 'engine'] as const;
export type BatchRule = (typeof BATCH_RULES)[number];

/** Request sizes for `count` frames under a rule, in frame order. */
export function requestSizes(count: number, rule: Exclude<BatchRule, 'engine'>, parallel: number): number[] {
  if (count <= 0) return [];
  if (rule === 'fill-16' || rule === 'fill-8') {
    const max = rule === 'fill-16' ? 16 : 8;
    return Array.from({ length: Math.ceil(count / max) }, (_, i) => Math.min(max, count - i * max));
  }
  const needed = Math.ceil(count / 16);
  const requests = Math.min(count, Math.ceil(needed / parallel) * parallel);
  const base = Math.floor(count / requests);
  return Array.from({ length: requests }, (_, i) => base + (i < count % requests ? 1 : 0));
}

/** An engine that cuts each call by `rule` and keeps `parallel` requests in flight on `single`. */
export function batchedEngine(
  single: OcrEngine,
  rule: Exclude<BatchRule, 'engine'>,
  parallel: number,
): OcrEngine {
  return {
    capabilities: () => single.capabilities(),
    async recognize(frames, options): AsyncResult<OcrPage[]> {
      const sizes = requestSizes(frames.length, rule, parallel);
      const starts = sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0));
      const pages = await inFlight(sizes.length, parallel, (n) =>
        single.recognize(frames.slice(starts[n] ?? 0, (starts[n] ?? 0) + (sizes[n] ?? 0)), options),
      );
      return pages.ok ? ok(pages.value.flat()) : err(pages.error);
    },
  };
}
