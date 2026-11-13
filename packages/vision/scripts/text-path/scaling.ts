// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Apple Vision's own concurrency (IX3-O1): the same frames read as 16-frame requests with `concurrency` of
 * them in flight. A shipped helper runs two OCR requests at a time (its slot gate), so `concurrency` above
 * `perHelper` (2) is spread over `ceil(concurrency / perHelper)` helper processes; a helper built with more OCR
 * slots (`--per-helper`) shows one process's own scaling. One request per worker, workers take the
 * next batch as they finish (no tail of one long batch). The frames are BMP files the helper reads, so nothing
 * is encoded while the clock runs. Pages are kept to check that concurrency changes no reading.
 */
import { HELPER_BATCH } from '../../src/ocr/apple-vision';
import { createOcrMeter } from '../../src/ocr/meter';
import type { OcrEngine, OcrFrame, OcrPage } from '../../src/ocr/types';
import type { StudyHelper } from './helpers';

export interface ScalingRun {
  /** Requests in flight. */
  readonly concurrency: number;
  readonly helpers: number;
  readonly frames: number;
  readonly wallMs: number;
  readonly framesPerSecond: number;
  /** Vision's own time per image, as the helper measured it (mean). */
  readonly visionMsPerImage: number;
  readonly loadAtStart: number;
}

/** Text of each frame's observations, by the frame's key, for comparing runs. */
export type PageTexts = Map<string, string>;

export interface KeyedFrame {
  readonly key: string;
  readonly frame: OcrFrame;
}

export async function readConcurrently(
  helpers: readonly StudyHelper[],
  frames: readonly KeyedFrame[],
  concurrency: number,
  languages: readonly string[],
  load: () => number,
  perHelper = 2,
): Promise<{ run: ScalingRun; texts: PageTexts }> {
  const used = Math.ceil(concurrency / perHelper);
  if (helpers.length < used) throw new Error(`${concurrency} in flight needs ${used} helpers`);
  const engines: OcrEngine[] = helpers.slice(0, used).map((helper) => helper.engine({ inFlight: 1 }));
  const batches: KeyedFrame[][] = [];
  for (let i = 0; i < frames.length; i += HELPER_BATCH) batches.push(frames.slice(i, i + HELPER_BATCH));
  const meter = createOcrMeter();
  const texts: PageTexts = new Map();
  const loadAtStart = load();
  let next = 0;
  const worker = async (n: number) => {
    // Workers 0 and 1 on helper 0, 2 and 3 on helper 1, … (`perHelper` requests per helper, its slot count).
    const engine = engines[Math.floor(n / perHelper)];
    if (!engine) throw new Error(`no engine for worker ${n}`);
    while (next < batches.length) {
      const batch = batches[next++] ?? [];
      const read = await engine.recognize(
        batch.map((item) => item.frame),
        { languages, meter },
      );
      if (!read.ok) throw new Error(`ocr: ${read.error.code} ${read.error.detail ?? ''}`);
      read.value.forEach((page: OcrPage, i) => texts.set(batch[i]?.key ?? '', textsOf(page)));
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, (_, n) => worker(n)));
  const wallMs = performance.now() - started;
  const counts = meter.counts();
  return {
    run: {
      concurrency,
      helpers: used,
      frames: counts.frames,
      wallMs: Math.round(wallMs),
      framesPerSecond: round1((counts.frames * 1000) / wallMs),
      visionMsPerImage: round1(counts.ms.engine / Math.max(1, counts.frames)),
      loadAtStart: round1(loadAtStart),
    },
    texts,
  };
}

export function textsOf(page: OcrPage): string {
  return page.observations.map((o) => o.text).join(' | ');
}

/** A frame read differently from the reference run, with both readings (the study's diff). */
export interface Difference {
  readonly key: string;
  readonly reference: string;
  readonly other: string;
}

/** Frames whose reading differs from the reference run's. */
export function differing(reference: PageTexts, other: PageTexts): Difference[] {
  const out: Difference[] = [];
  for (const [key, text] of reference) {
    const read = other.get(key) ?? '';
    if (read !== text) out.push({ key, reference: text, other: read });
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
