// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where on-screen-text time goes, on bench footage (IX-O1):
 *
 *   pnpm --filter @taalcut/vision exec tsx scripts/ocr-profile.ts --shots <shots.json> --out <dir>
 *     [--languages en] [--level accurate|fast] [--no-correction] [--no-auto-detect]
 *     [--min-height 0.03125] [--long-side 1280] [--window 32] [--in-flight 2] [--transfer bmp|png]
 *     [--clips a.mov,b.mp4] [--devanagari <PP-OCRv5 Devanagari model dir>]
 *     [--dump-frames <dir>]
 *
 * Runs the on-screen-text path (`readShotsText`: a sample a second on the
 * asset's one-second grid, shots read in windows, unchanged frames reusing a
 * page, sample-grain edges) with the real mac helper and counts
 * what it does with the OCR meter. Every page the engine returns is written to
 * the clip's JSON (`reads`), so tracking rules can be studied without reading
 * again. Commit 4a84c55f's copy of this script measured the shot-by-shot path
 * before IX-O4 (IX-O1's baseline); 0765fe2c's (`--no-refine`) measured indexing
 * with and without edge refinement (IX-O5).
 * `shots.json` is `{ clips: [{ path, shots: [{ start, end, bestFrame }] }] }`
 * on each file's grid (exported from a bench library). It decodes video and
 * runs Vision: run it under the VT lock.
 *
 * A study tool since IX3 (IX3-B2): it decodes its own frames (`sampleFrames`
 * on the shots it is given), not the frames the app's shots pass keeps for
 * `vision.ocr`, so its text is not what the app stores (round IX2 lost
 * "JARDIM" here, not in the app). Nothing gates on it; the gate is tools/evals
 * `eval:text-recall` (IX3-B1), which scores a bench library.
 */
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ok } from '@taalcut/core';
import { createBinaryResolver, createJsonLineSidecar, createSidecarResolver } from '@taalcut/media';
import { z } from 'zod';
import { VISION_CONFIG } from '../src/config';
import { fitLongSide, probeSource, sampleFrames, type VideoSource } from '../src/media/frames';
import { encodePng } from '../src/media/png';
import {
  createAppleVisionOcr,
  DEFAULT_IN_FLIGHT,
  DEFAULT_RECOGNITION,
  DEFAULT_TRANSFER,
} from '../src/ocr/apple-vision';
import { addOcrCounts, createOcrMeter, type OcrCounts, type OcrMeter } from '../src/ocr/meter';
import { readShotsText, shotSamples } from '../src/ocr/read-shots';
import { createOrtRuntime } from '../src/onnx/ort';
import { createPaddleDevanagariOcr } from '../src/ocr/paddle/engine';
import { createRoutedOcr } from '../src/ocr/router';
import type { OcrEngine, OcrFrame, OcrPage } from '../src/ocr/types';

const { values } = parseArgs({
  options: {
    shots: { type: 'string' },
    out: { type: 'string' },
    languages: { type: 'string', default: 'en' },
    level: { type: 'string', default: DEFAULT_RECOGNITION.level },
    'no-correction': { type: 'boolean', default: false },
    'no-auto-detect': { type: 'boolean', default: false },
    'min-height': { type: 'string', default: String(DEFAULT_RECOGNITION.minimumTextHeight) },
    'long-side': { type: 'string', default: String(VISION_CONFIG.breakdown.ocrLongSide) },
    window: { type: 'string', default: '32' },
    'in-flight': { type: 'string', default: String(DEFAULT_IN_FLIGHT) },
    transfer: { type: 'string', default: DEFAULT_TRANSFER },
    clips: { type: 'string' },
    devanagari: { type: 'string' },
    'dump-frames': { type: 'string' },
  },
});

const shotsFileSchema = z.object({
  clips: z.array(
    z.object({
      path: z.string().min(1),
      shots: z.array(
        z.object({
          start: z.number().int().min(0),
          end: z.number().int().min(1),
          bestFrame: z.number().int(),
        }),
      ),
    }),
  ),
});
type Clip = z.infer<typeof shotsFileSchema>['clips'][number];

interface Run {
  readonly media: { readonly binaries: Parameters<typeof probeSource>[0]['binaries'] };
  readonly ocr: OcrEngine;
  readonly languages: readonly string[];
  readonly longSide: number;
  readonly window: number;
}

async function decode(
  run: Run,
  source: VideoSource,
  request: { frames?: readonly number[]; every?: number },
  meter: OcrMeter,
): Promise<OcrFrame[]> {
  const started = performance.now();
  const sampled = await sampleFrames(run.media, source, {
    size: fitLongSide(source.width, source.height, run.longSide),
    format: 'rgb24',
    ...request,
  });
  meter.decoded('sample', performance.now() - started);
  if (!sampled.ok) throw new Error(`decode: ${sampled.error.code} ${sampled.error.detail ?? ''}`);
  return sampled.value.map((f) => ({ index: f.index, width: f.width, height: f.height, rgb: f.data }));
}

const pageJson = (page: OcrPage) => ({
  frame: page.frame,
  observations: page.observations.map((o) => ({
    text: o.text,
    confidence: Math.round(o.confidence * 1000) / 1000,
    box: o.box,
    script: o.script,
    ...(o.language ? { language: o.language } : {}),
    engine: o.engine,
  })),
});

/** An engine that keeps every page it returns, for the clip's JSON. */
function recording(engine: OcrEngine): OcrEngine & { readonly pages: OcrPage[] } {
  const pages: OcrPage[] = [];
  return {
    pages,
    capabilities: () => engine.capabilities(),
    async recognize(frames, options) {
      const read = await engine.recognize(frames, options);
      if (read.ok) pages.push(...read.value);
      return read;
    },
  };
}

async function profileClip(run: Run, clip: Clip, dumpDir: string | undefined) {
  const probed = await probeSource(run.media, clip.path);
  if (!probed.ok) throw new Error(`probe ${clip.path}: ${probed.error.code}`);
  const source = probed.value;
  const still = source.plan.kind === 'image';
  const every = still ? 1 : Math.max(1, Math.round(source.rate.num / source.rate.den));
  const meter = createOcrMeter();
  const load = loadavg()[0] ?? 0;
  // One decode of the grid samples per clip (after the decode lane they come from the analysis pass's cache).
  const cache = new Map(
    (still
      ? await decode(run, source, { frames: [0] }, meter)
      : await decode(run, source, { every }, meter)
    ).map((f) => [f.index, f]),
  );
  const samples = new Set(clip.shots.flatMap((shot) => shotSamples(shot, every)));
  const frames = async (indexes: readonly number[]) => {
    const missing = indexes.filter((f) => !cache.has(f));
    // Best frames of shots with no grid sample.
    if (missing.length > 0)
      for (const f of await decode(run, source, { frames: missing }, meter)) cache.set(f.index, f);
    return ok(indexes.flatMap((f) => cache.get(f) ?? []));
  };
  const engine = recording(run.ocr);
  const started = performance.now();
  const read = await readShotsText(
    { rate: source.rate, shots: clip.shots, every, languages: run.languages },
    { ocr: engine, frames, meter },
    { window: run.window },
  );
  if (!read.ok) throw new Error(`ocr: ${read.error.code} ${read.error.detail ?? ''}`);
  const ocrMs = performance.now() - started;
  if (dumpDir)
    await dumpFrames(
      dumpDir,
      clip.path,
      [...cache.values()].filter((f) => samples.has(f.index)),
    );
  return {
    file: basename(clip.path),
    width: source.width,
    height: source.height,
    rate: source.rate,
    frameCount: source.frameCount ?? 0,
    loadAtStart: Math.round(load * 10) / 10,
    ocrMs: Math.round(ocrMs),
    counts: meter.counts(),
    shots: clip.shots.map((shot, i) => ({
      ...shot,
      texts: (read.value[i] ?? []).map((t) => ({
        text: t.text,
        start: t.range.start.value,
        frames: t.range.duration.value,
        confidence: Math.round(t.confidence * 1000) / 1000,
        reveal: t.reveal,
        box: t.box,
      })),
    })),
    reads: engine.pages.map(pageJson),
  };
}

async function dumpFrames(dir: string, path: string, frames: readonly OcrFrame[]): Promise<void> {
  const target = join(dir, basename(path));
  await mkdir(target, { recursive: true });
  for (const frame of frames)
    await writeFile(join(target, `${frame.index}.png`), encodePng(frame.rgb, frame.width, frame.height, 3));
}

function row(file: string, seconds: number, c: OcrCounts, ocrMs: number): string {
  const cells = [
    file,
    seconds.toFixed(0),
    c.sampled,
    c.reused,
    c.requests,
    c.frames,
    c.refineCalls,
    c.refineDecodes,
    c.tracks,
    c.flickers,
    c.ms.decode,
    c.ms.encode,
    c.ms.request,
    c.ms.engine,
    c.ms.parse,
    Math.round(ocrMs),
  ];
  return `| ${cells.join(' | ')} |\n`;
}

async function main(): Promise<number> {
  if (!values.shots || !values.out) {
    console.error('usage: ocr-profile --shots <shots.json> --out <dir> [options]');
    return 2;
  }
  const parsed = shotsFileSchema.safeParse(JSON.parse(await readFile(values.shots, 'utf8')));
  if (!parsed.success) {
    console.error(`bad shots file: ${parsed.error.message}`);
    return 2;
  }
  const only = values.clips ? new Set(values.clips.split(',')) : undefined;
  const clips = parsed.data.clips.filter((c) => !only || only.has(basename(c.path)));
  const binaries = await createBinaryResolver({ development: true }).resolve();
  if (!binaries.ok) throw new Error(`no FFmpeg: ${binaries.error.code}`);
  const helper = await createSidecarResolver({
    name: 'taalcut-mac-helper',
    development: true,
    pin: '',
    env: process.env,
  }).resolve();
  if (!helper.ok) throw new Error(`no mac helper: ${helper.error.code}`);
  await mkdir(join(values.out, 'tmp'), { recursive: true });
  const temp = await realpath(join(values.out, 'tmp'));
  const sidecar = createJsonLineSidecar({
    command: helper.value.path,
    args: ['serve', '--services', 'ocr,image', '--allow-root', temp],
  });
  const level = values.level === 'fast' ? 'fast' : 'accurate';
  const recognition = {
    level,
    languageCorrection: !values['no-correction'],
    autoDetectLanguage: !values['no-auto-detect'],
    minimumTextHeight: Number(values['min-height']),
  } as const;
  const run: Run = {
    media: { binaries: binaries.value },
    ocr: createRoutedOcr({
      vision: createAppleVisionOcr(sidecar, {
        tempDir: temp,
        recognition,
        inFlight: Number(values['in-flight']),
        transfer: values.transfer === 'png' ? 'png' : 'bmp',
      }),
      // Hindi asked: PP-OCRv5 Devanagari on ONNX Runtime (WebGPU), as the app routes it.
      ...(values.devanagari
        ? {
            devanagari: createPaddleDevanagariOcr({
              onnx: createOrtRuntime({}),
              modelDir: values.devanagari,
            }),
          }
        : {}),
    }),
    languages: values.languages.split(',').filter(Boolean),
    longSide: Number(values['long-side']),
    window: Number(values.window),
  };
  const settings = {
    recognition,
    languages: run.languages,
    longSide: run.longSide,
    window: run.window,
    inFlight: Number(values['in-flight']),
    transfer: values.transfer === 'png' ? 'png' : 'bmp',
  };
  process.stdout.write(`settings ${JSON.stringify(settings)}\n`);
  process.stdout.write(
    '| File | s | sampled | reused | requests | frames | refine | refine decodes | tracks | flickers | decode ms | encode ms | request ms | vision ms | parse ms | OCR wall ms |\n',
  );
  process.stdout.write(`${'| --- '.repeat(16)}|\n`);
  let total: OcrCounts | undefined;
  let totalMs = 0;
  let totalSeconds = 0;
  try {
    for (const clip of clips) {
      const result = await profileClip(run, clip, values['dump-frames']);
      const seconds = result.frameCount / (result.rate.num / result.rate.den);
      await writeFile(
        join(values.out, `${result.file}.json`),
        JSON.stringify({ settings, ...result, seconds }),
      );
      process.stdout.write(row(result.file, seconds, result.counts, result.ocrMs));
      total = total ? addOcrCounts(total, result.counts) : result.counts;
      totalMs += result.ocrMs;
      totalSeconds += seconds;
    }
  } finally {
    await sidecar.close();
  }
  if (total) {
    process.stdout.write(row('total', totalSeconds, total, totalMs));
    await writeFile(
      join(values.out, 'total.json'),
      JSON.stringify({ settings, seconds: totalSeconds, ocrMs: totalMs, counts: total }),
    );
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
