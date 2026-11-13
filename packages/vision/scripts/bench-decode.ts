// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How long vision's shots and analyse stages keep the video engine busy, and
 * how many FFmpeg/ffprobe runs and decodes they make per asset (IX-D1, IX-D2,
 * IX-D6), on a folder of footage:
 *
 *   pnpm --filter @taalcut/vision bench:decode --dir <footage> --out <json> [--mode shared|alone|proxy]
 *
 * `shared`: the jobs' way since IX-D2 (normalise's plan, one frame cache, the
 * shots stage's pass read by analyse). `proxy`: the same, decoding the proxy
 * (encoded first, not timed). `alone`: each stage on its own with only the
 * path, the only calls older code also has, so the same script measures the
 * old code when its sources are checked out. No embedder (cut pairs are not
 * embedded) and an OCR engine that reads nothing (its frames are still
 * fetched): `ocr` times vision.ocr's frame reads (IX-O5; before it, analyse
 * fetched them). Every command is recorded; `--classify <json>` adds the decode
 * classes with media's classifier afterwards. Run it under the VT lock.
 */
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ok } from '@taalcut/core';
import * as media from '@taalcut/media';
import { analyzeShots } from '../src/analysis/analyze-shots';
import { withFrameSource } from '../src/media/media-frame-source';
import { readShotText } from '../src/ocr/shot-text';
import { detectShots } from '../src/shots/detect-shots';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    out: { type: 'string' },
    mode: { type: 'string', default: 'shared' },
    classify: { type: 'string' },
  },
});

interface Command {
  readonly command: string;
  readonly args: readonly string[];
}

interface StageRun {
  readonly ms: number;
  readonly commands: readonly Command[];
  readonly ok: boolean;
}

const VIDEO = new Set(['.mov', '.mp4', '.m4v']);

function recording(ctx: media.MediaContext, into: Command[]): media.MediaContext {
  const inner = ctx.runner ?? media.runProcess;
  return {
    ...ctx,
    runner: (command, args, options) => {
      into.push({ command, args: [...args] });
      return inner(command, args, options);
    },
  };
}

async function timed(run: (commands: Command[]) => Promise<boolean>): Promise<StageRun> {
  const commands: Command[] = [];
  const started = performance.now();
  const passed = await run(commands);
  return { ms: Math.round(performance.now() - started), commands, ok: passed };
}

const quietOcr = {
  capabilities: async () => ok({ scripts: ['latin' as const], languages: ['en'] }),
  recognize: async (frames: readonly { index: number }[]) =>
    ok(frames.map((f) => ({ frame: f.index, observations: [] }))),
};

/** Each stage on its own, with only the path (calls older code has too). */
async function alone(base: media.MediaContext, path: string) {
  const shots = await timed(
    async (commands) => (await detectShots(path, { media: recording(base, commands) })).ok,
  );
  const found = await detectShots(path, { media: base });
  if (!found.ok) return undefined;
  const input = { path, shots: found.value.shots.map((range, i) => ({ shotId: `s${i}`, range })) };
  const analyse = await timed(
    async (commands) => (await analyzeShots(input, { media: recording(base, commands) })).ok,
  );
  const ocr = await timed(async (commands) => {
    const read = await withFrameSource(undefined, recording(base, commands), path, undefined, (frames) =>
      readShotText(input.shots, frames, quietOcr, ['en']),
    );
    return read.ok;
  });
  return { shots, analyse, ocr, cuts: found.value.cuts.map((c) => c.frame) };
}

/** The jobs' way (IX-D2): normalise's plan, one cache, analyse reading what shots left; `proxy` decodes the proxy. */
async function shared(base: media.MediaContext, path: string, scratch: string, proxy: boolean) {
  const { openFrameSource } = await import('../src/media/media-frame-source');
  const { frameInputFor } = await import('../src/media/frame-source-policy');
  const probed = await media.probeMedia(path, base);
  if (!probed.ok) return undefined;
  const planned = media.planNormalisation(probed.value);
  if (!planned.ok) return undefined;
  const plan = planned.value;
  let proxyInput: { path: string; plan: media.NormalisationPlan } | undefined;
  if (proxy) {
    const out = join(scratch, `${Date.now()}-proxy.mp4`);
    // The real size: the proxy ladder caps the proxy's bitrate at a share of the original's.
    const sizeBytes = (await stat(path)).size;
    const made = await media.makeProxy(path, plan, base, { out, sizeBytes, contentHash: 'ab'.repeat(32) });
    const file = made.ok ? made.value.file : undefined;
    const input = frameInputFor('proxy', { kind: plan.kind, rate: plan.frameRate.output }, file);
    if (file && input === 'proxy')
      proxyInput = { path: out, plan: media.settledPlan(plan, plan.frameRate.output) };
  }
  const cache = media.createFrameCache({ root: join(scratch, 'frames') });
  const open = { assetId: path, path, plan, ...(proxyInput ? { proxy: proxyInput } : {}) };
  const deps = (commands: Command[]) => ({ media: recording(base, commands), tempDir: scratch, cache });
  let cuts: number[] = [];
  let input: Parameters<typeof analyzeShots>[0] | undefined;
  const shots = await timed(async (commands) => {
    const source = await openFrameSource(deps(commands), open);
    if (!source.ok) return false;
    source.value.expect(['vision.analyse', 'vision.ocr']);
    const found = await detectShots(path, { media: base, frames: source.value, keepOcrFrames: true });
    await source.value.close();
    if (!found.ok) return false;
    cuts = found.value.cuts.map((c) => c.frame);
    input = { path, shots: found.value.shots.map((range, i) => ({ shotId: `s${i}`, range })) };
    return true;
  });
  const analyse = await timed(async (commands) => {
    const source = await openFrameSource(deps(commands), open);
    if (!source.ok || !input) return false;
    const result = await analyzeShots(input, { media: base, frames: source.value, keepOcrFrames: true });
    await source.value.close();
    await source.value.release('vision.analyse');
    return result.ok;
  });
  const ocr = await timed(async (commands) => {
    const source = await openFrameSource(deps(commands), open);
    if (!source.ok || !input) return false;
    const read = await readShotText(input.shots, source.value, quietOcr, ['en']);
    await source.value.close();
    await source.value.release('vision.ocr');
    return read.ok;
  });
  await cache.clear();
  return { shots, analyse, ocr, cuts, input: proxyInput ? 'proxy' : 'original' };
}

async function bench(dir: string, mode: string): Promise<unknown> {
  const binaries = await media.createBinaryResolver({ development: true }).resolve();
  if (!binaries.ok) throw new Error(binaries.error.code);
  const base: media.MediaContext = { binaries: binaries.value, toneMaps: new media.ToneMapSelection() };
  const scratch = await mkdtemp(join(tmpdir(), 'taalcut-bench-decode-'));
  const files = (await readdir(dir)).filter((name) => VIDEO.has(extname(name).toLowerCase())).sort();
  const assets = [];
  try {
    for (const name of files) {
      const path = join(dir, name);
      const run =
        mode === 'alone' ? await alone(base, path) : await shared(base, path, scratch, mode === 'proxy');
      if (run) assets.push({ file: name, ...run });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return { measuredAt: new Date().toISOString(), mode, dir, assets };
}

async function main(): Promise<number> {
  if (values.classify) {
    const report = JSON.parse(await readFile(values.classify, 'utf8')) as {
      dir: string;
      assets: { file: string; shots: StageRun; analyse: StageRun; ocr?: StageRun }[];
    };
    const summary = report.assets.map((asset) => {
      const count = (run: StageRun) => {
        const tally = media.createDecodeTally(join(report.dir, asset.file));
        for (const c of run.commands) tally.record(c.command, c.args);
        return { ms: run.ms, ...tally.snapshot() };
      };
      return {
        file: asset.file,
        shots: count(asset.shots),
        analyse: count(asset.analyse),
        ...(asset.ocr ? { ocr: count(asset.ocr) } : {}),
      };
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }
  if (!values.dir || !values.out) {
    console.error('usage: bench:decode --dir <footage> --out <json> [--mode shared|alone|proxy]');
    return 2;
  }
  const report = await bench(values.dir, values.mode ?? 'shared');
  await writeFile(values.out, JSON.stringify(report, null, 2));
  return 0;
}

process.exitCode = await main();
