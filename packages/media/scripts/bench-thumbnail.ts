// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-T1: how long the poster frame takes per clip and decode route, wall and
 * CPU (every FFmpeg run of it under `/usr/bin/time`), median of `--runs`:
 *
 *   pnpm --filter @taalcut/media bench:thumbnail --dir <footage> --out <json> [--runs 3] [--extra a.mov,b.mov]
 *
 * Routes: `exact-vt` (the five exact frames, one seek each: the rule before
 * IX2), `kf-vt` (keyframes, runs grouped as in production), `kf-vt-seeks`
 * (keyframes, one run per target), and `kf-sw`, `kf-sw-seeks` (the same on
 * the software decoder). Every route ends with the same pick run. Run it under
 * the VT lock, on AC power.
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { loadavg, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { RationalTime } from '@taalcut/core';
import * as media from '@taalcut/media';
import { benchContext, cpuOf, median, planFile, timedContext } from './bench-timing';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    extra: { type: 'string' },
    out: { type: 'string' },
    runs: { type: 'string', default: '3' },
    routes: { type: 'string', default: 'exact-vt,kf-vt,kf-vt-seeks,kf-sw,kf-sw-seeks' },
  },
});

interface Route {
  readonly software: boolean;
  readonly options: media.ThumbnailOptions['route'];
}

const ROUTES = new Map<string, Route>([
  ['exact-vt', { software: false, options: { exact: true } }],
  ['kf-vt', { software: false, options: {} }],
  ['kf-vt-seeks', { software: false, options: { gapSeconds: 0 } }],
  ['exact-sw', { software: true, options: { exact: true } }],
  ['kf-sw', { software: true, options: {} }],
  ['kf-sw-seeks', { software: true, options: { gapSeconds: 0 } }],
]);

interface Sample {
  readonly wallMs: number;
  readonly cpuMs: number;
  readonly runs: number;
  readonly source: string;
  readonly jpegSha: string;
}

const VIDEO = new Set(['.mov', '.mp4', '.m4v']);

function forced(plan: media.NormalisationPlan, software: boolean): media.NormalisationPlan {
  if (!software) return plan;
  return {
    ...plan,
    decode: { backend: 'software', fallbackReason: { code: 'requested', detail: 'IX2-T1 bench' } },
  };
}

async function one(
  ctx: media.MediaContext,
  path: string,
  plan: media.NormalisationPlan,
  route: Route,
): Promise<Sample> {
  const dir = await mkdtemp(join(tmpdir(), 'taalcut-thumb-bench-'));
  try {
    const timeFile = join(dir, 'time.txt');
    const out = join(dir, 'thumb.jpg');
    const started = performance.now();
    const options = route.options ? { route: route.options } : {};
    const source = forced(plan, route.software);
    const made = await media.makeThumbnail(path, source, timedContext(ctx, timeFile), out, options);
    const wallMs = Math.round(performance.now() - started);
    if (!made.ok) throw new Error(`${path}: ${made.error.code} ${made.error.detail ?? ''}`);
    const { cpuMs, runs } = await cpuOf(timeFile);
    const jpeg = await readFile(out);
    const jpegSha = createHash('sha256').update(jpeg).digest('hex').slice(0, 12);
    return { wallMs, cpuMs, runs, source: made.value.source ?? 'still', jpegSha };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function filesOf(dir: string | undefined, extra: string | undefined): Promise<string[]> {
  const names = dir ? await readdir(dir) : [];
  const videos = names.filter((name) => VIDEO.has(extname(name).toLowerCase())).sort();
  return [...videos.map((name) => join(dir ?? '', name)), ...(extra ?? '').split(',').filter(Boolean)];
}

/** Every route on one clip, route by route: the clip stays in the page cache for each. */
async function measure(ctx: media.MediaContext, path: string, routes: readonly string[], runs: number) {
  const plan = await planFile(ctx, path);
  const loadAtStart = loadavg()[0];
  const byRoute: Record<string, { samples: Sample[]; wallMs: number; cpuMs: number }> = {};
  for (const name of routes) {
    const route = ROUTES.get(name);
    if (!route) continue;
    const samples: Sample[] = [];
    for (let i = 0; i < runs; i++) samples.push(await one(ctx, path, plan, route));
    const wallMs = median(samples.map((s) => s.wallMs));
    byRoute[name] = { samples, wallMs, cpuMs: median(samples.map((s) => s.cpuMs)) };
    process.stdout.write(`${path} ${name} ${JSON.stringify(byRoute[name])}\n`);
  }
  const { source } = plan;
  return {
    file: path,
    codec: source.codec,
    width: source.displayWidth,
    height: source.displayHeight,
    bitDepth: source.bitDepth,
    hdr: plan.hdr,
    rotation: plan.rotation,
    seconds: RationalTime.toSeconds(plan.duration),
    decode: plan.decode.backend,
    loadAtStart,
    routes: byRoute,
  };
}

async function main() {
  if (!values.out) throw new Error('--out <json> is required');
  const ctx = await benchContext();
  const routes = (values.routes ?? '').split(',');
  const runs = Math.max(1, Number(values.runs));
  const results = [];
  for (const path of await filesOf(values.dir, values.extra)) {
    results.push(await measure(ctx, path, routes, runs));
    await appendFile(`${values.out}.progress`, `${path}\n`);
  }
  const report = { measuredAt: new Date().toISOString(), runs, results };
  await writeFile(values.out, JSON.stringify(report, null, 2));
}

await main();
