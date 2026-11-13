// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where `vision.ocr`'s time goes, and what keeps the Neural Engine busy (IX3-O1):
 *
 *   pnpm --filter @taalcut/vision exec tsx scripts/study-text-path.ts --jobs <jobs.json> --frames <dir> --out <dir>
 *     [--prepare] [--scaling 1,2,3,4,6] [--modes fill-16-x1,fill-16-x2,even-x1,even-x2] [--rounds 2]
 *     [--devanagari <PP-OCRv5 Devanagari folder>] [--scaling-frames 320]
 *
 * `jobs.json` is the bench library's `vision.readShotText` payloads, in the order they ran
 * (`select json_group_array(json(payload)) from jobs where kind = 'vision.readShotText' order by started_at`).
 * `--prepare` decodes every job's samples into `--frames` once (FFmpeg). `--scaling` reads the first
 * `--scaling-frames` frames with each number of requests in flight (scaling.ts). `--modes` runs every job as the
 * handler does (jobs.ts) under each request rule (batching.ts) with 1 or 2 jobs at once (`x1`, `x2`). Modes and
 * concurrencies run in order, then reversed, `--rounds` times. Decodes video and runs Vision and PP-OCR: run it
 * under the VT lock.
 */
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { createBinaryResolver } from '@taalcut/media';
import { encodeBmp } from '../src/media/bmp';
import { createPaddleDevanagariOcr } from '../src/ocr/paddle/engine';
import { createRoutedOcr } from '../src/ocr/router';
import { createOrtRuntime } from '../src/onnx/ort';
import { batchedEngine, BATCH_RULES, type BatchRule } from './text-path/batching';
import { diskFrameSource, parseJobs, prepareJob, storedFrames } from './text-path/disk-frames';
import { closeHelpers, startHelpers, type StudyHelper } from './text-path/helpers';
import { differingShots, runJobs, type JobsRun } from './text-path/jobs';
import {
  differing,
  readConcurrently,
  type Difference,
  type KeyedFrame,
  type ScalingRun,
} from './text-path/scaling';
import type { ReadShotTextInput } from '../src/jobs/ocr-kinds';

const { values } = parseArgs({
  options: {
    jobs: { type: 'string' },
    frames: { type: 'string' },
    out: { type: 'string' },
    prepare: { type: 'boolean', default: false },
    scaling: { type: 'string' },
    'scaling-frames': { type: 'string', default: '320' },
    modes: { type: 'string' },
    rounds: { type: 'string', default: '2' },
    devanagari: { type: 'string' },
    'per-helper': { type: 'string', default: '2' },
  },
});
const perHelper = Number(values['per-helper']);

const load = () => loadavg()[0] ?? 0;
const log = (line: string) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${line}\n`);

interface Mode {
  readonly name: string;
  readonly rule: BatchRule;
  readonly parallel: number;
}

function parseMode(name: string): Mode {
  const match = /^(.+)-x([12])$/.exec(name);
  const rule = BATCH_RULES.find((r) => r === match?.[1]);
  if (!match || !rule) throw new Error(`bad mode ${name}: <${BATCH_RULES.join('|')}>-x<1|2>`);
  return { name, rule, parallel: Number(match[2]) };
}

/** Each round runs the list forward, then backward, so drift in the machine's load falls on both sides. */
function rounds<T>(items: readonly T[], count: number): T[] {
  return Array.from({ length: count }, () => [...items, ...[...items].reverse()]).flat();
}

/** Every stored frame as a BMP the helper can read (written before any clock runs). */
async function bmpFrames(jobs: readonly ReadShotTextInput[], framesDir: string, dir: string, limit: number) {
  const out: KeyedFrame[] = [];
  for (const job of jobs) {
    const { source } = await diskFrameSource(job, framesDir);
    const stored = await storedFrames(job, framesDir);
    const read = await source.frames({ size: stored, format: 'rgb24', frames: stored.frames });
    if (!read.ok) throw new Error(`read ${job.path}`);
    const folder = join(dir, basename(job.path));
    await mkdir(folder, { recursive: true });
    for (const frame of read.value) {
      if (out.length >= limit) return out;
      const path = join(folder, `${frame.index}.bmp`);
      await writeFile(path, encodeBmp(frame.data, frame.width, frame.height));
      const key = `${basename(job.path)}#${frame.index}`;
      out.push({
        key,
        frame: { index: frame.index, width: frame.width, height: frame.height, rgb: new Uint8Array(0), path },
      });
    }
  }
  return out;
}

async function scalingStudy(
  helpers: readonly StudyHelper[],
  frames: readonly KeyedFrame[],
  levels: number[],
  count: number,
) {
  const runs: ScalingRun[] = [];
  const reference = (await readConcurrently(helpers, frames, 1, ['en'], load, perHelper)).texts;
  const changed: Record<number, string[]> = {};
  const diffs: Difference[] = [];
  for (const concurrency of rounds(levels, count)) {
    const { run, texts } = await readConcurrently(helpers, frames, concurrency, ['en'], load, perHelper);
    runs.push(run);
    const differences = differing(reference, texts);
    diffs.push(...differences);
    changed[concurrency] = [...new Set([...(changed[concurrency] ?? []), ...differences.map((d) => d.key)])];
    log(
      `scaling ${concurrency}: ${run.framesPerSecond} frames/s, Vision ${run.visionMsPerImage} ms an image`,
    );
  }
  return { runs, changed, diffs };
}

async function jobsStudy(
  helper: StudyHelper,
  jobs: readonly ReadShotTextInput[],
  framesDir: string,
  modes: readonly Mode[],
  count: number,
) {
  const single = helper.engine({ inFlight: 1 });
  const devanagari = values.devanagari
    ? createPaddleDevanagariOcr({ onnx: createOrtRuntime({}), modelDir: values.devanagari })
    : undefined;
  const routed = (mode: Mode) =>
    createRoutedOcr({
      vision: mode.rule === 'engine' ? helper.engine() : batchedEngine(single, mode.rule, 2),
      ...(devanagari ? { devanagari } : {}),
    });
  // PP-OCR's WebGPU sessions load on the first Hindi read: once, untimed, as a warm app process would have them.
  const hindi = jobs.filter((job) => job.languages.includes('hi')).slice(0, 1);
  const firstMode = modes[0];
  if (hindi.length > 0 && firstMode) await runJobs('warm-up', hindi, framesDir, routed(firstMode), 1);
  const runs: JobsRun[] = [];
  for (const mode of rounds(modes, count)) {
    const ocr = routed(mode);
    const run = await runJobs(mode.name, jobs, framesDir, ocr, mode.parallel);
    runs.push(run);
    const first = runs[0];
    const lost = first ? differingShots(first, run).length : 0;
    log(`${mode.name}: wall ${run.wallMs} ms, busy ${run.busyMs} ms, shots reading differently ${lost}`);
  }
  await devanagari?.close?.();
  return runs;
}

async function main(): Promise<number> {
  if (!values.jobs || !values.frames || !values.out) {
    console.error('usage: study-text-path --jobs <jobs.json> --frames <dir> --out <dir> [options]');
    return 2;
  }
  const jobs = parseJobs(JSON.parse(await readFile(values.jobs, 'utf8')));
  await mkdir(values.frames, { recursive: true });
  await mkdir(values.out, { recursive: true });
  const framesDir = await realpath(values.frames);
  const out = await realpath(values.out);
  if (values.prepare) {
    const binaries = await createBinaryResolver({ development: true }).resolve();
    if (!binaries.ok) throw new Error(`no FFmpeg: ${binaries.error.code}`);
    for (const job of jobs)
      log(
        `prepared ${basename(job.path)}: ${await prepareJob({ binaries: binaries.value }, job, framesDir)} frames`,
      );
  }
  const levels = values.scaling ? values.scaling.split(',').map(Number) : [];
  const modes = values.modes ? values.modes.split(',').map(parseMode) : [];
  const count = Number(values.rounds);
  const bmpDir = join(out, 'bmp');
  await mkdir(bmpDir, { recursive: true });
  const frames = await bmpFrames(jobs, framesDir, bmpDir, Number(values['scaling-frames']));
  const helpers = await startHelpers(
    Math.max(1, ...levels.map((c) => Math.ceil(c / perHelper))),
    join(out, 'tmp'),
    [bmpDir],
    frames.slice(0, 2).map((f) => f.frame),
  );
  const result: Record<string, unknown> = { at: new Date().toISOString(), loadAtStart: load() };
  try {
    if (levels.length > 0) result['scaling'] = await scalingStudy(helpers, frames, levels, count);
    const first = helpers[0];
    if (modes.length > 0 && first) result['jobs'] = await jobsStudy(first, jobs, framesDir, modes, count);
  } finally {
    await closeHelpers(helpers);
  }
  await writeFile(join(out, 'study.json'), JSON.stringify(result, null, 1));
  log(`wrote ${join(out, 'study.json')}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
