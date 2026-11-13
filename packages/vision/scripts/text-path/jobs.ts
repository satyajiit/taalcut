// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `vision.ocr` job's own path, timed (IX3-O1 study): each bench job runs `readShotText` as the handler
 * does (windows, reuse, BMP transfer, the routed engine, tracking) over its frames on disk, `parallel` jobs at
 * once in the bench's order (the `vision.ocr` lane's limit), sharing one helper as the app does. Per job: wall,
 * reading frames, the engine calls (Vision's transfer and requests; PP-OCR on the Hindi files) and the rest
 * (reuse planning, plausibility, tracking). Each shot's texts are kept to check a mode reads the same words.
 */
import { basename } from 'node:path';
import { loadavg } from 'node:os';
import type { ReadShotTextInput } from '../../src/jobs/ocr-kinds';
import { createOcrMeter, type OcrCounts, type OcrMeter } from '../../src/ocr/meter';
import { readShotText } from '../../src/ocr/shot-text';
import type { OcrEngine } from '../../src/ocr/types';
import { diskFrameSource } from './disk-frames';

export interface JobTiming {
  readonly file: string;
  readonly startMs: number;
  readonly wallMs: number;
  readonly readMs: number;
  /** Time inside the routed engine's calls (transfer, Vision requests, PP-OCR). */
  readonly engineCallMs: number;
  /** PP-OCR's share of it (Hindi files). */
  readonly devanagariMs: number;
  readonly counts: OcrCounts;
  /** Each shot's texts, joined. */
  readonly texts: readonly string[];
}

export interface JobsRun {
  readonly label: string;
  readonly parallel: number;
  readonly wallMs: number;
  readonly busyMs: number;
  readonly loadAtStart: number;
  readonly jobs: readonly JobTiming[];
}

/** Times the calls of one job on the shared engine. */
function timedEngine(engine: OcrEngine): OcrEngine & { readonly ms: () => number } {
  let ms = 0;
  return {
    capabilities: () => engine.capabilities(),
    async recognize(frames, options) {
      const started = performance.now();
      const read = await engine.recognize(frames, options);
      ms += performance.now() - started;
      return read;
    },
    ms: () => ms,
  };
}

/** A job's meter that also adds up PP-OCR's request time on its own. */
function splitMeter(): { meter: OcrMeter; devanagariMs: () => number } {
  const inner = createOcrMeter();
  let devanagari = 0;
  const meter: OcrMeter = {
    ...inner,
    request(entry) {
      if (entry.engine !== 'apple-vision') devanagari += entry.requestMs;
      inner.request(entry);
    },
  };
  return { meter, devanagariMs: () => devanagari };
}

async function runJob(
  job: ReadShotTextInput,
  framesDir: string,
  ocr: OcrEngine,
  t0: number,
): Promise<JobTiming> {
  const { source, readMs } = await diskFrameSource(job, framesDir);
  const engine = timedEngine(ocr);
  const { meter, devanagariMs } = splitMeter();
  const started = performance.now();
  const read = await readShotText(job.shots, source, engine, job.languages, { meter });
  const wallMs = performance.now() - started;
  if (!read.ok) throw new Error(`${job.path}: ${read.error.code} ${read.error.detail ?? ''}`);
  return {
    file: basename(job.path),
    startMs: Math.round(started - t0),
    wallMs: Math.round(wallMs),
    readMs: Math.round(readMs()),
    engineCallMs: Math.round(engine.ms()),
    devanagariMs: Math.round(devanagariMs()),
    counts: meter.counts(),
    texts: read.value.map((shot) => shot.onScreenText.map((t) => t.text).join(' | ')),
  };
}

/** Every job, `parallel` at once in the given order. */
export async function runJobs(
  label: string,
  jobs: readonly ReadShotTextInput[],
  framesDir: string,
  ocr: OcrEngine,
  parallel: number,
): Promise<JobsRun> {
  const out = new Array<JobTiming>(jobs.length);
  const loadAtStart = loadavg()[0] ?? 0;
  const t0 = performance.now();
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const n = next++;
      const job = jobs[n];
      if (job) out[n] = await runJob(job, framesDir, ocr, t0);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  const wallMs = performance.now() - t0;
  return {
    label,
    parallel,
    wallMs: Math.round(wallMs),
    busyMs: out.reduce((sum, job) => sum + job.wallMs, 0),
    loadAtStart: Math.round(loadAtStart * 10) / 10,
    jobs: out,
  };
}

/** Shots whose texts differ between two runs of the same jobs, as `file#shot`. */
export function differingShots(a: JobsRun, b: JobsRun): string[] {
  return a.jobs.flatMap((job, j) =>
    job.texts.flatMap((text, s) => (b.jobs[j]?.texts[s] === text ? [] : [`${job.file}#${s}`])),
  );
}
