// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core ML weight variants against today's component (IX3-N2): the IX set's frames, transcript segments and
 * on-screen text tracks, as an indexing bench's library stored them, embedded by each `embeddinggemma-2-coreml`
 * folder through the mac helper, and each variant's vectors compared with the baseline's item by item:
 *
 *   pnpm --filter @taalcut/vision study:coreml-weights --library <run>/run-1/index-library.sqlite \
 *     --baseline <label>=<dir> --variant <label>=<dir>... --out <dir> [--queries <json>] [--rounds 1]
 *
 * Frames are read once (the stage's own read, at the 140-token index size) and given to every model the stage's
 * way (one `embedImages` call per asset); texts as documents and `--queries` (a JSON array of strings, e.g. the
 * search study's probes) as queries. `--rounds` repeats the models in turn for the timings. Writes each model's
 * vectors (`vectors-<label>.json`) and `compare.json`: cosine to the baseline per kind (median, minimum, first
 * percentile), the first call's time (a load, or Core ML's compile the first time a folder is loaded) and frames/s
 * and texts/s. Loads models on the GPU and Neural Engine and decodes video: run it under the VT lock, on AC power.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import { unwrap } from '@taalcut/core';
import * as media from '@taalcut/media';
import { z } from 'zod';
import type { VisionEmbedder } from '../src/embed/embedder';
import { embeddingFrameSize, type ImageTokenBudget } from '../src/embed/space';
import { videoSourceOf, type SampledFrame } from '../src/media/frames';
import { currentRead } from './embed-frames/current';
import { benchEmbedder } from './embed-frames/model';
import { timed } from './embed-frames/timing';
import { readIxSet, type IxSet } from './study/ix-set';
import { compareVectors, vectorsJson, type Vectors } from './study/vector-compare';

const TOKENS: ImageTokenBudget = 140;

const { values } = parseArgs({
  options: {
    library: { type: 'string' },
    baseline: { type: 'string' },
    variant: { type: 'string', multiple: true, default: [] },
    queries: { type: 'string' },
    out: { type: 'string' },
    rounds: { type: 'string', default: '1' },
    model: { type: 'string', default: fileURLToPath(new URL('../.cache/embeddinggemma-2', import.meta.url)) },
  },
});

interface Folder {
  readonly label: string;
  readonly dir: string;
}

function folder(value: string): Folder {
  const at = value.indexOf('=');
  if (at <= 0 || !/^[a-z0-9][a-z0-9-]*$/.test(value.slice(0, at)))
    throw new Error(`${value}: write it as <label>=<dir>, the label in lowercase words and hyphens`);
  const dir = resolve(value.slice(at + 1));
  if (!existsSync(dir)) throw new Error(`no Core ML folder at ${dir}`);
  return { label: value.slice(0, at), dir };
}

interface Frames {
  readonly itemIds: readonly string[];
  readonly frames: readonly SampledFrame[];
}

/** Every asset's frames, read once the stage's way. */
async function readFrames(ctx: media.MediaContext, set: IxSet, scratch: string): Promise<Frames[]> {
  const out: Frames[] = [];
  for (const asset of set.assets) {
    const video = videoSourceOf(asset.path, asset.plan);
    const size = embeddingFrameSize(video.width, video.height, TOKENS);
    const request = { ...asset, frames: asset.frames.map((f) => f.frame), benchFfmpeg: 0, benchMs: 0 };
    const read = await currentRead(ctx, request, size, scratch);
    if (read.frames.length !== asset.frames.length)
      throw new Error(`${asset.file}: ${read.frames.length} frames for ${asset.frames.length}`);
    out.push({ itemIds: asset.frames.map((f) => f.itemId), frames: read.frames });
  }
  return out;
}

interface Measured {
  readonly vectors: Vectors;
  readonly firstCallMs: number;
  readonly framesPerSecond: number;
  readonly textsPerSecond: number;
}

/** One model over the whole set: a query first (the load, or the first compile), then frames, texts, queries. */
async function embedAll(
  embedder: VisionEmbedder,
  frames: readonly Frames[],
  set: IxSet,
  queries: readonly string[],
): Promise<Measured> {
  const vectors = new Map<string, Float32Array>();
  const first = await timed(async () => unwrap(await embedder.embedTexts(['warm'], { purpose: 'query' })));
  const framed = await timed(async () => {
    for (const asset of frames) {
      const images = asset.frames.map((f) => ({ width: f.width, height: f.height, rgb: f.data }));
      const got = unwrap(await embedder.embedImages(images));
      got.forEach((vector, i) => vectors.set(asset.itemIds[i] ?? `frame:?:${i}`, vector));
    }
  });
  const texted = await timed(async () =>
    unwrap(
      await embedder.embedTexts(
        set.texts.map((t) => t.text),
        { purpose: 'document' },
      ),
    ),
  );
  texted.value.forEach((vector, i) => vectors.set(set.texts[i]?.itemId ?? `text:${i}`, vector));
  if (queries.length > 0) {
    const asked = unwrap(await embedder.embedTexts(queries, { purpose: 'query' }));
    asked.forEach((vector, i) => vectors.set(`query:${i}`, vector));
  }
  const frameCount = frames.reduce((sum, asset) => sum + asset.frames.length, 0);
  return {
    vectors,
    firstCallMs: Math.round(first.ms),
    framesPerSecond: Number((frameCount / (framed.ms / 1000)).toFixed(2)),
    textsPerSecond: Number((set.texts.length / (texted.ms / 1000)).toFixed(1)),
  };
}

/** Writes each model's vectors and returns the comparison: per model, cosine to the baseline (the first folder). */
async function report(
  folders: readonly Folder[],
  runs: ReadonlyMap<string, readonly Measured[]>,
  out: string,
): Promise<Record<string, unknown>> {
  const baseline = runs.get(folders[0]?.label ?? '')?.[0]?.vectors;
  if (!baseline) throw new Error('no baseline vectors');
  const compared: Record<string, unknown> = {};
  for (const { label, dir } of folders) {
    const measured = runs.get(label) ?? [];
    const own = measured[0]?.vectors;
    if (!own) continue;
    await writeFile(
      join(out, `vectors-${label}.json`),
      JSON.stringify({ label, dir, items: vectorsJson(own) }),
    );
    compared[label] = {
      dir,
      cosineToBaseline: compareVectors(baseline, own),
      // Its own repeat: how far a model is from itself between loads (Core ML on the GPU isn't bit-exact).
      ...(measured[1] ? { cosineToItself: compareVectors(own, measured[1].vectors) } : {}),
      firstCallMs: measured.map((m) => m.firstCallMs),
      framesPerSecond: measured.map((m) => m.framesPerSecond),
      textsPerSecond: measured.map((m) => m.textsPerSecond),
    };
  }
  return compared;
}

/** Every folder's model over the set, `rounds` times in turn. */
async function measureAll(
  folders: readonly Folder[],
  rounds: number,
  input: {
    frames: readonly Frames[];
    set: IxSet;
    queries: readonly string[];
    scratch: string;
    model: string;
  },
): Promise<Map<string, Measured[]>> {
  const runs = new Map<string, Measured[]>();
  for (let round = 0; round < Math.max(1, rounds); round += 1) {
    for (const { label, dir } of folders) {
      const embedder = await benchEmbedder({
        modelDir: input.model,
        coremlDir: dir,
        tempDir: input.scratch,
        imageTokens: TOKENS,
      });
      try {
        const measured = await embedAll(embedder, input.frames, input.set, input.queries);
        if (embedder.device() !== 'coreml')
          throw new Error(`${label} ran on ${embedder.device() ?? 'nothing'}`);
        runs.set(label, [...(runs.get(label) ?? []), measured]);
        const { firstCallMs, framesPerSecond, textsPerSecond } = measured;
        process.stdout.write(
          `round ${round + 1} ${label.padEnd(14)} first call ${firstCallMs} ms  ${framesPerSecond} frames/s  ${textsPerSecond} texts/s  load ${loadavg()[0]?.toFixed(1)}\n`,
        );
      } finally {
        await embedder.close();
      }
    }
  }
  return runs;
}

async function main(): Promise<number> {
  if (!values.library || !values.baseline || !values.out) {
    console.error(
      'usage: study:coreml-weights --library <sqlite> --baseline <label>=<dir> --variant … --out <dir>',
    );
    return 2;
  }
  const folders = [folder(values.baseline), ...values.variant.map(folder)];
  const queries = values.queries
    ? z.array(z.string()).parse(JSON.parse(readFileSync(values.queries, 'utf8')))
    : [];
  const set = readIxSet(values.library);
  const binaries = await media.createBinaryResolver({ development: true }).resolve();
  if (!binaries.ok) throw new Error(`no FFmpeg: ${binaries.error.code}`);
  const ctx: media.MediaContext = { binaries: binaries.value, toneMaps: new media.ToneMapSelection() };
  await mkdir(values.out, { recursive: true });
  // The helper resolves symlinks before it checks its allowed root.
  const scratch = await realpath(await mkdtemp(join(values.out, 'scratch-')));
  try {
    const frames = await readFrames(ctx, set, scratch);
    process.stdout.write(
      `${set.assets.length} assets, ${frames.reduce((s, a) => s + a.frames.length, 0)} frames, ${set.texts.length} texts, ${queries.length} queries\n`,
    );
    const runs = await measureAll(folders, Number(values.rounds), {
      frames,
      set,
      queries,
      scratch,
      model: values.model,
    });
    const compared = await report(folders, runs, values.out);
    await writeFile(join(values.out, 'compare.json'), `${JSON.stringify(compared, null, 1)}\n`);
    process.stdout.write(`${JSON.stringify(compared, null, 1)}\n`);
    return 0;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

process.exitCode = await main();
