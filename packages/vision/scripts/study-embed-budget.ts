// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Image-token budget study (IX-E2): retrieval quality and throughput of
 * EmbeddingGemma 2 frames at several soft-token budgets and batch sizes, on
 * this Mac, on the production path (FFmpeg scaling, transformers.js, WebGPU).
 *
 *   pnpm --filter @taalcut/vision study:embed --images <dir> [--budgets 280,140,70]
 *     [--batches 1,4,8,16] [--runs 3] [--device webgpu] [--coreml <embeddinggemma-2-coreml dir>] [--out <json>]
 *
 * `--images` holds the subjects of scripts/study/user-pictures.json as PNGs
 * (see its `about`). Each subject is framed three ways (study/framings.ts),
 * every budget embeds every frame, and each query ranks the frames. Text
 * vectors don't depend on the image budget, so queries are embedded once.
 * Throughput: the wide frames in each batch size, after one warm-up batch,
 * the median of `--runs`. Vectors of each batch size are checked against
 * batch 1 (padding must not change a frame's vector). `--coreml` runs the mac
 * helper's Core ML model instead of transformers.js (IX2-E5).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createBinaryResolver } from '@taalcut/media';
import { z } from 'zod';
import {
  EMBEDDING_DEVICES,
  loadTransformersModel,
  VISION_ENCODER_DTYPES,
  type EmbeddingDevice,
  type EmbeddingImage,
  type EmbeddingModel,
  type VisionEncoderDtype,
} from '../src/embed/model';
import {
  IMAGE_TOKEN_BUDGETS,
  imageTokens,
  prefixed,
  unitVector,
  type ImageTokenBudget,
} from '../src/embed/space';
import { FRAMINGS, frameSubjects, loadFrames, type FramedStill } from './study/framings';
import { numberList } from './study/args';
import { coreMlLoader } from './study/coreml';
import { agreement, median, scoreByLanguage, type QueryVector, type RetrievalScore } from './study/metrics';

const LANGUAGES = ['en', 'es', 'pt-BR', 'hi'] as const;

const subjectsSchema = z.object({
  subjects: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        queries: z.object({ en: z.string(), es: z.string(), 'pt-BR': z.string(), hi: z.string() }),
      }),
    )
    .min(2),
});

const { values } = parseArgs({
  options: {
    images: { type: 'string' },
    labels: {
      type: 'string',
      default: fileURLToPath(new URL('./study/user-pictures.json', import.meta.url)),
    },
    model: { type: 'string', default: fileURLToPath(new URL('../.cache/embeddinggemma-2', import.meta.url)) },
    budgets: { type: 'string', default: '280,140,70' },
    batches: { type: 'string', default: '1,4,8,16' },
    runs: { type: 'string', default: '3' },
    device: { type: 'string', default: 'webgpu' },
    'vision-dtype': { type: 'string', default: 'q4' },
    coreml: { type: 'string' },
    out: { type: 'string' },
  },
});

async function timedRuns(
  model: EmbeddingModel,
  frames: readonly EmbeddingImage[],
  batch: number,
  runs: number,
): Promise<{ framesPerSecond: number; spread: [number, number]; vectors: Float32Array[] }> {
  await model.embedImages(frames.slice(0, batch));
  const rates: number[] = [];
  let vectors: Float32Array[] = [];
  for (let run = 0; run < runs; run++) {
    const out: Float32Array[] = [];
    const started = performance.now();
    for (let i = 0; i < frames.length; i += batch)
      out.push(...(await model.embedImages(frames.slice(i, i + batch))));
    rates.push(frames.length / ((performance.now() - started) / 1000));
    vectors = out.map(unitVector);
  }
  return {
    framesPerSecond: median(rates),
    spread: [Math.min(...rates), Math.max(...rates)],
    vectors,
  };
}

interface BudgetResult {
  readonly budget: ImageTokenBudget;
  readonly frameSizes: Record<string, string>;
  readonly tokensPerFrame: Record<string, number>;
  readonly loadMs: number;
  readonly throughput: Record<
    string,
    { framesPerSecond: number; spread: [number, number]; minCosineToBatch1: number }
  >;
  readonly retrieval: Record<string, Record<string, RetrievalScore>>;
  /** Per framing: cosine of each frame's vector to the first budget's vector of the same frame. */
  readonly agreementToFirst: Record<string, { mean: number; min: number }>;
  readonly rssGiB: number;
}

/** Frames per second at each batch size over the 16:9 frames, and how far batching moves a vector. */
async function measureThroughput(
  model: EmbeddingModel,
  frames: readonly EmbeddingImage[],
  batches: readonly number[],
  runs: number,
): Promise<BudgetResult['throughput']> {
  const throughput: BudgetResult['throughput'] = {};
  let batch1: Float32Array[] | undefined;
  for (const batch of batches) {
    const timed = await timedRuns(model, frames, batch, runs);
    batch1 ??= timed.vectors;
    throughput[String(batch)] = {
      framesPerSecond: Number(timed.framesPerSecond.toFixed(3)),
      spread: [Number(timed.spread[0].toFixed(3)), Number(timed.spread[1].toFixed(3))],
      minCosineToBatch1: Number(agreement(timed.vectors, batch1).min.toFixed(6)),
    };
  }
  return throughput;
}

/** Search scores per framing and over all of them; agreement with the first budget measured. */
async function measureRetrieval(
  model: EmbeddingModel,
  framed: (framing: string) => { stills: readonly FramedStill[]; frames: readonly EmbeddingImage[] },
  queries: readonly QueryVector[],
  reference: Map<string, Float32Array[]>,
): Promise<Pick<BudgetResult, 'retrieval' | 'agreementToFirst'>> {
  const retrieval: BudgetResult['retrieval'] = {};
  const agreementToFirst: BudgetResult['agreementToFirst'] = {};
  const all: { subject: string; vector: Float32Array }[] = [];
  for (const framing of FRAMINGS) {
    const { stills, frames } = framed(framing);
    const vectors = await embedAll(model, frames, 4);
    const ranked = stills.flatMap((s, i) => {
      const vector = vectors[i];
      return vector ? [{ subject: s.subject, vector }] : [];
    });
    all.push(...ranked);
    retrieval[framing] = scoreByLanguage(queries, ranked);
    const ref = reference.get(framing);
    if (ref) agreementToFirst[framing] = agreement(vectors, ref);
    else reference.set(framing, vectors);
  }
  retrieval['all'] = scoreByLanguage(queries, all);
  return { retrieval, agreementToFirst };
}

/** What each budget loads: the mac helper's Core ML model with `--coreml`, else transformers.js on `device`. */
async function modelSource(
  device: EmbeddingDevice,
  visionDtype: VisionEncoderDtype,
  tempDir: string,
): Promise<{ load: () => Promise<EmbeddingModel>; device: EmbeddingDevice; visionDtype: string }> {
  if (!values.coreml) {
    return { load: () => loadTransformersModel(values.model, device, { visionDtype }), device, visionDtype };
  }
  const load = await coreMlLoader({ coremlDir: values.coreml, tokenizerDir: values.model, tempDir });
  return { load, device: 'coreml', visionDtype: 'coreml' };
}

async function main(): Promise<number> {
  const imagesDir = values.images;
  if (!imagesDir) throw new Error('--images <dir> is required');
  if (!existsSync(join(values.model, 'onnx', 'model_q4.onnx_data')))
    throw new Error(`no model at ${values.model}`);
  const device = EMBEDDING_DEVICES.find((d) => d === values.device);
  if (!device) throw new Error(`--device must be one of ${EMBEDDING_DEVICES.join(', ')}`);
  const visionDtype = VISION_ENCODER_DTYPES.find((d) => d === values['vision-dtype']);
  if (!visionDtype) throw new Error(`--vision-dtype must be one of ${VISION_ENCODER_DTYPES.join(', ')}`);
  const budgets = numberList(values.budgets, IMAGE_TOKEN_BUDGETS, 'budget');
  const batches = numberList(values.batches, [1, 2, 4, 6, 8, 12, 16, 24, 32], 'batch');
  const runs = Math.max(1, Number(values.runs));
  const labels = subjectsSchema.parse(JSON.parse(readFileSync(values.labels, 'utf8')));
  const binaries = await createBinaryResolver({ development: true }).resolve();
  if (!binaries.ok) throw new Error(`no FFmpeg: ${binaries.error.code}`);
  const media = { binaries: binaries.value };
  const work = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-study-')));
  const source = await modelSource(device, visionDtype, work);
  try {
    const photos = labels.subjects.map((s) => ({ id: s.id, path: join(imagesDir, `${s.id}.png`) }));
    const missing = photos.filter((p) => !existsSync(p.path));
    if (missing.length > 0) throw new Error(`missing photos: ${missing.map((p) => p.id).join(', ')}`);
    const stills = await frameSubjects(media, photos, work);
    const byFraming = (framing: string) => stills.filter((s) => s.framing === framing);

    let queries: QueryVector[] = [];
    const results: BudgetResult[] = [];
    const reference = new Map<string, Float32Array[]>();
    for (const budget of budgets) {
      const started = performance.now();
      const model = await source.load();
      const loadMs = Math.round(performance.now() - started);
      if (model.device !== source.device) throw new Error(`asked for ${source.device}, got ${model.device}`);
      if (queries.length === 0) queries = await embedQueries(model, labels.subjects);
      const frames = new Map<string, EmbeddingImage[]>();
      for (const framing of FRAMINGS)
        frames.set(framing, await loadFrames(media, byFraming(framing), budget));

      const wide = frames.get('wide') ?? [];
      const throughput = await measureThroughput(model, wide, batches, runs);
      const measured = await measureRetrieval(
        model,
        (framing) => ({ stills: byFraming(framing), frames: frames.get(framing) ?? [] }),
        queries,
        reference,
      );
      const sizes = Object.fromEntries(
        FRAMINGS.flatMap((f) => {
          const first = frames.get(f)?.[0];
          return first ? [[f, first]] : [];
        }),
      );
      results.push({
        budget,
        frameSizes: Object.fromEntries(Object.entries(sizes).map(([f, i]) => [f, `${i.width}x${i.height}`])),
        tokensPerFrame: Object.fromEntries(Object.entries(sizes).map(([f, i]) => [f, imageTokens(i)])),
        loadMs,
        throughput,
        ...measured,
        rssGiB: Number((process.memoryUsage().rss / 2 ** 30).toFixed(2)),
      });
      await model.dispose();
      const last = results.at(-1);
      if (last) print(last);
    }
    const report = {
      device: source.device,
      visionDtype: source.visionDtype,
      subjects: labels.subjects.length,
      queries: queries.length,
      runs,
      results,
    };
    if (values.out) writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function embedQueries(
  model: EmbeddingModel,
  subjects: z.output<typeof subjectsSchema>['subjects'],
): Promise<QueryVector[]> {
  const flat = subjects.flatMap((s) =>
    LANGUAGES.map((language) => ({ subject: s.id, language, text: s.queries[language] })),
  );
  const vectors: Float32Array[] = [];
  for (let i = 0; i < flat.length; i += 16) {
    vectors.push(...(await model.embedTexts(flat.slice(i, i + 16).map((q) => prefixed(q.text, 'query')))));
  }
  return flat.flatMap((q, i) => {
    const vector = vectors[i];
    return vector ? [{ subject: q.subject, language: q.language, vector: unitVector(vector) }] : [];
  });
}

async function embedAll(
  model: EmbeddingModel,
  frames: readonly EmbeddingImage[],
  batch: number,
): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < frames.length; i += batch)
    out.push(...(await model.embedImages(frames.slice(i, i + batch))));
  return out.map(unitVector);
}

function print(result: BudgetResult): void {
  const fmt = (n: number) => n.toFixed(3);
  const lines = [
    `budget ${result.budget}: sizes ${JSON.stringify(result.frameSizes)} tokens ${JSON.stringify(result.tokensPerFrame)} load ${result.loadMs} ms rss ${result.rssGiB} GiB`,
    ...Object.entries(result.throughput).map(
      ([batch, t]) =>
        `  batch ${batch.padStart(2)}: ${fmt(t.framesPerSecond)} frames/s (${fmt(t.spread[0])}–${fmt(t.spread[1])}), min cos to batch 1 ${t.minCosineToBatch1}`,
    ),
    ...Object.entries(result.retrieval).map(
      ([framing, byLanguage]) =>
        `  ${framing.padEnd(5)} ${Object.entries(byLanguage)
          .map(([key, s]) => `${key} ${fmt(s.hit1)}/${fmt(s.hit5)}/${fmt(s.mrr)}`)
          .join('  ')}`,
    ),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

process.exitCode = await main();
