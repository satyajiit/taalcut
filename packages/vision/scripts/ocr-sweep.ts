// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Vision settings and throughput on frames already on disk (IX-O2, IX-O6):
 *
 *   pnpm --filter @taalcut/vision exec tsx scripts/ocr-sweep.ts --frames <dir> --configs <configs.json> --out <dir>
 *
 * `--frames` is what `ocr-profile.ts --dump-frames` wrote: one folder per
 * clip of `<grid frame>.png`. Each config of `configs.json`
 * (`[{ name, level, languageCorrection, autoDetectLanguage, minimumTextHeight,
 * languages, batch, inFlight }]`) reads every frame of every clip through the
 * real mac helper, `batch` frames per request and `inFlight` requests at once,
 * and writes `<name>.json`: per clip the wall time, Vision's own time and
 * every page, so recall and agreement with another config are computed
 * offline. No decoding and no PNG encoding: the helper reads the files. Run
 * it under the VT lock (Vision runs on the Neural Engine and GPU).
 */
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createJsonLineSidecar, createSidecarResolver } from '@taalcut/media';
import { z } from 'zod';
import { createAppleVisionOcr, DEFAULT_RECOGNITION, HELPER_BATCH } from '../src/ocr/apple-vision';
import { createOcrMeter } from '../src/ocr/meter';
import type { OcrEngine, OcrFrame, OcrPage } from '../src/ocr/types';

const { values } = parseArgs({
  options: {
    frames: { type: 'string' },
    configs: { type: 'string' },
    out: { type: 'string' },
    clips: { type: 'string' },
  },
});

const configSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  level: z.enum(['accurate', 'fast']).default(DEFAULT_RECOGNITION.level),
  languageCorrection: z.boolean().default(DEFAULT_RECOGNITION.languageCorrection),
  autoDetectLanguage: z.boolean().default(DEFAULT_RECOGNITION.autoDetectLanguage),
  minimumTextHeight: z.number().min(0).max(1).default(DEFAULT_RECOGNITION.minimumTextHeight),
  languages: z.array(z.string()).default(['en']),
  batch: z.number().int().min(1).max(HELPER_BATCH).default(HELPER_BATCH),
  inFlight: z.number().int().min(1).max(8).default(1),
});
type Config = z.infer<typeof configSchema>;

/** Frames on disk: the helper reads them, so no pixels are needed. */
async function clipFrames(dir: string): Promise<OcrFrame[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.png'));
  return names
    .map((n) => Number(n.replace('.png', '')))
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      width: 0,
      height: 0,
      rgb: new Uint8Array(0),
      path: join(dir, `${index}.png`),
    }));
}

/** Reads `frames` in requests of `batch`, `inFlight` at once; pages in frame order. */
async function readAll(
  ocr: OcrEngine,
  frames: readonly OcrFrame[],
  config: Config,
  meter: ReturnType<typeof createOcrMeter>,
): Promise<OcrPage[]> {
  const batches: OcrFrame[][] = [];
  for (let i = 0; i < frames.length; i += config.batch) batches.push(frames.slice(i, i + config.batch));
  const pages = new Array<OcrPage[]>(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const n = next++;
      const read = await ocr.recognize(batches[n] ?? [], { languages: config.languages, meter });
      if (!read.ok) throw new Error(`ocr: ${read.error.code} ${read.error.detail ?? ''}`);
      pages[n] = read.value;
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.inFlight, batches.length) }, worker));
  return pages.flat();
}

async function main(): Promise<number> {
  if (!values.frames || !values.configs || !values.out) {
    console.error('usage: ocr-sweep --frames <dir> --configs <configs.json> --out <dir> [--clips a,b]');
    return 2;
  }
  const configs = z.array(configSchema).parse(JSON.parse(await readFile(values.configs, 'utf8')));
  const root = await realpath(values.frames);
  const only = values.clips ? new Set(values.clips.split(',')) : undefined;
  const clips = (await readdir(root)).filter((c) => !c.startsWith('.') && (!only || only.has(c))).sort();
  const helper = await createSidecarResolver({
    name: 'taalcut-mac-helper',
    development: true,
    pin: '',
    env: process.env,
  }).resolve();
  if (!helper.ok) throw new Error(`no mac helper: ${helper.error.code}`);
  await mkdir(values.out, { recursive: true });
  process.stdout.write('| Config | frames | wall ms | ms/frame | Vision ms/frame | observations | load |\n');
  process.stdout.write(`${'| --- '.repeat(7)}|\n`);
  for (const config of configs) {
    // A fresh helper per config, so no config inherits another's warm state unfairly; one warm-up read first.
    const sidecar = createJsonLineSidecar({
      command: helper.value.path,
      args: ['serve', '--services', 'ocr,image', '--allow-root', root],
    });
    const ocr = createAppleVisionOcr(sidecar, {
      tempDir: root,
      recognition: {
        level: config.level,
        languageCorrection: config.languageCorrection,
        autoDetectLanguage: config.autoDetectLanguage,
        minimumTextHeight: config.minimumTextHeight,
      },
    });
    try {
      const first = clips[0] ? (await clipFrames(join(root, clips[0])))[0] : undefined;
      if (first) await ocr.recognize([first], { languages: config.languages });
      const result = [];
      let frames = 0;
      let wall = 0;
      let engine = 0;
      let observations = 0;
      const load = loadavg()[0] ?? 0;
      for (const clip of clips) {
        const meter = createOcrMeter();
        const list = await clipFrames(join(root, clip));
        const started = performance.now();
        const pages = await readAll(ocr, list, config, meter);
        const ms = performance.now() - started;
        const counts = meter.counts();
        frames += list.length;
        wall += ms;
        engine += counts.ms.engine;
        observations += pages.reduce((sum, p) => sum + p.observations.length, 0);
        result.push({
          clip,
          frames: list.length,
          wallMs: Math.round(ms),
          counts,
          pages: pages.map((p) => ({
            frame: p.frame,
            observations: p.observations.map((o) => ({
              text: o.text,
              confidence: Math.round(o.confidence * 1000) / 1000,
              box: o.box,
              ...(o.language ? { language: o.language } : {}),
            })),
          })),
        });
      }
      await writeFile(join(values.out, `${config.name}.json`), JSON.stringify({ config, clips: result }));
      const cells = [
        config.name,
        frames,
        Math.round(wall),
        (wall / Math.max(1, frames)).toFixed(1),
        (engine / Math.max(1, frames)).toFixed(1),
        observations,
        load.toFixed(1),
      ];
      process.stdout.write(`| ${cells.join(' | ')} |\n`);
    } finally {
      await sidecar.close();
    }
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
