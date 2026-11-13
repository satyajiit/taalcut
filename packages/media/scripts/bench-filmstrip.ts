// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-T3: how long the filmstrip sprite takes from a proxy, exact grid frames
 * (before IX2) against the proxy's keyframes, wall and CPU (the FFmpeg run
 * under `/usr/bin/time`), median of `--runs`:
 *
 *   pnpm --filter @taalcut/media bench:filmstrip --files a.mp4,b.mp4 --out <json> [--runs 3]
 *
 * The files are proxies (or stand-ins with the proxy's shape: H.264, 1280
 * long side, a closed GOP of half a second). Run it under the VT lock.
 */
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { RationalTime } from '@taalcut/core';
import * as media from '@taalcut/media';
import { benchContext, cpuOf, median, planFile, timedContext } from './bench-timing';

const { values } = parseArgs({
  options: {
    files: { type: 'string' },
    out: { type: 'string' },
    runs: { type: 'string', default: '3' },
  },
});

const READS = [
  ['exact', false],
  ['keyframes', true],
] as const;

async function one(ctx: media.MediaContext, path: string, plan: media.NormalisationPlan, proxy: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'taalcut-strip-bench-'));
  try {
    const timeFile = join(dir, 'time.txt');
    const out = join(dir, 'strip.jpg');
    const layout = media.filmstripLayout(plan);
    const read = media.spriteRead(path, plan, { method: 'none', backend: 'software' }, layout, { proxy });
    const started = performance.now();
    const run = await media.runFfmpeg(timedContext(ctx, timeFile), [
      '-y',
      ...read.args,
      '-q:v',
      '3',
      '-update',
      '1',
      out,
    ]);
    const wallMs = Math.round(performance.now() - started);
    if (!run.ok) throw new Error(`${path}: ${run.error.code} ${run.error.detail ?? ''}`);
    const { cpuMs } = await cpuOf(timeFile);
    return { wallMs, cpuMs, source: read.source, bytes: (await stat(out)).size };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function measure(ctx: media.MediaContext, path: string, runs: number) {
  const plan = await planFile(ctx, path);
  const loadAtStart = loadavg()[0];
  const reads: Record<string, unknown> = {};
  for (const [name, proxy] of READS) {
    const samples = [];
    for (let i = 0; i < runs; i++) samples.push(await one(ctx, path, plan, proxy));
    reads[name] = {
      samples,
      wallMs: median(samples.map((s) => s.wallMs)),
      cpuMs: median(samples.map((s) => s.cpuMs)),
    };
    process.stdout.write(`${path} ${name} ${JSON.stringify(reads[name])}\n`);
  }
  const tiles = media.filmstripLayout(plan).tiles.length;
  return { file: path, seconds: RationalTime.toSeconds(plan.duration), tiles, loadAtStart, reads };
}

async function main() {
  if (!values.out || !values.files) throw new Error('--files and --out are required');
  const ctx = await benchContext();
  const runs = Math.max(1, Number(values.runs));
  const results = [];
  for (const path of values.files.split(',').filter(Boolean)) results.push(await measure(ctx, path, runs));
  await writeFile(
    values.out,
    JSON.stringify({ measuredAt: new Date().toISOString(), runs, results }, null, 2),
  );
}

await main();
