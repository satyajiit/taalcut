// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Duplicate thresholds per image-token budget (IX2-E2): a labelled near-duplicate set generated from the budget
 * study's photos (study/duplicate-set.ts), each image embedded at every budget on the production path (FFmpeg scaling
 * to the budget's frame size, transformers.js) and dHashed as the analysis pass does (gray, 256 px long side). Prints
 * and writes, per budget: the shipped rule's precision, recall and per-kind grouping with 280's thresholds and with
 * that budget's configured thresholds, the distance scale against 280, the thresholds that scale gives, and the room
 * between the lowest duplicate and the highest non-duplicate similarity.
 *
 *   pnpm --filter @taalcut/vision study:duplicates --images <dir> [--budgets 280,140,70] [--device webgpu]
 *     [--coreml <embeddinggemma-2-coreml dir>] [--out <json>]
 *
 * `--coreml` embeds through the mac helper's Core ML model instead (IX3-N2: a weight variant's own fit).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createBinaryResolver, type MediaContext } from '@taalcut/media';
import { duplicateThresholds } from '../src/analysis/duplicates';
import { EMBEDDING_DEVICES, loadTransformersModel, type EmbeddingModel } from '../src/embed/model';
import { IMAGE_TOKEN_BUDGETS, unitVector, type ImageTokenBudget } from '../src/embed/space';
import { fitLongSide, probeSource, sampleFrames } from '../src/media/frames';
import { dHash, hamming } from '../src/quality/frame-stats';
import { numberList } from './study/args';
import { coreMlLoader } from './study/coreml';
import { labelledPairs, writeVariants, type VariantImage } from './study/duplicate-set';
import {
  decide,
  distanceScale,
  margins,
  scaledThresholds,
  scoreRule,
  type ScoredPair,
} from './study/duplicate-fit';
import { loadFrames } from './study/framings';

const { values } = parseArgs({
  options: {
    images: { type: 'string' },
    labels: {
      type: 'string',
      default: fileURLToPath(new URL('./study/user-pictures.json', import.meta.url)),
    },
    model: { type: 'string', default: fileURLToPath(new URL('../.cache/embeddinggemma-2', import.meta.url)) },
    budgets: { type: 'string', default: '280,140,70' },
    device: { type: 'string', default: 'webgpu' },
    coreml: { type: 'string' },
    out: { type: 'string' },
  },
});

/** The analysis pass's dHash: gray frames at 256 px on the long side. */
async function hashOf(media: MediaContext, path: string): Promise<string> {
  const source = await probeSource(media, path);
  if (!source.ok) throw new Error(`${path}: ${source.error.code}`);
  const size = fitLongSide(source.value.width, source.value.height, 256);
  const frames = await sampleFrames(media, source.value, { size, format: 'gray', frames: [0] });
  const frame = frames.ok ? frames.value[0] : undefined;
  if (!frame) throw new Error(`${path}: no gray frame`);
  return dHash(frame.data, frame.width, frame.height);
}

async function embedAll(
  model: EmbeddingModel,
  media: MediaContext,
  images: readonly VariantImage[],
  budget: ImageTokenBudget,
): Promise<Map<string, Float32Array>> {
  const stills = images.map((i) => ({ subject: i.subject, framing: 'wide' as const, path: i.path }));
  const frames = await loadFrames(media, stills, budget);
  const out = new Map<string, Float32Array>();
  for (const [n, frame] of frames.entries()) {
    const [vector] = await model.embedImages([frame]);
    const image = images[n];
    if (vector && image) out.set(image.path, unitVector(vector));
  }
  return out;
}

const dot = (a: Float32Array, b: Float32Array) => a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);

async function main(): Promise<number> {
  if (!values.images) throw new Error('--images <dir> is required');
  const device = EMBEDDING_DEVICES.find((d) => d === values.device);
  if (!device) throw new Error(`--device must be one of ${EMBEDDING_DEVICES.join(', ')}`);
  const budgets = numberList(values.budgets, IMAGE_TOKEN_BUDGETS, 'budget');
  if (budgets[0] !== 280) throw new Error('the first budget is the reference: 280');
  const binaries = await createBinaryResolver({ development: true }).resolve();
  if (!binaries.ok) throw new Error(`no FFmpeg: ${binaries.error.code}`);
  const media = { binaries: binaries.value };
  const labels = JSON.parse(readFileSync(values.labels, 'utf8')) as { subjects: { id: string }[] };
  // The helper resolves symlinks before it checks its allowed root.
  const work = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-dups-study-')));
  try {
    const photos = labels.subjects.map((s) => ({ id: s.id, path: join(values.images ?? '', `${s.id}.png`) }));
    const images = await writeVariants(media, photos, work);
    const hashes = new Map<string, string>();
    for (const image of images) hashes.set(image.path, await hashOf(media, image.path));

    const model = values.coreml
      ? await (
          await coreMlLoader({ coremlDir: values.coreml, tokenizerDir: values.model, tempDir: work })
        )()
      : await loadTransformersModel(values.model, device);
    const vectors = new Map<ImageTokenBudget, Map<string, Float32Array>>();
    for (const budget of budgets) vectors.set(budget, await embedAll(model, media, images, budget));
    await model.dispose();

    // Hard negatives: the two other subjects whose base frame is closest at 280.
    const reference = vectors.get(280) ?? new Map<string, Float32Array>();
    const bases = images.filter((i) => i.variant === 'base');
    const similarBases = (subject: string) => {
      const own = bases.find((b) => b.subject === subject);
      const mine = own ? reference.get(own.path) : undefined;
      if (!mine) return [];
      return bases
        .filter((b) => b.subject !== subject)
        .map((b) => ({ subject: b.subject, sim: dot(mine, reference.get(b.path) ?? new Float32Array(768)) }))
        .sort((x, y) => y.sim - x.sim)
        .slice(0, 2)
        .map((x) => x.subject);
    };
    const pairs: ScoredPair[] = labelledPairs(images, similarBases).map((p) => ({
      kind: p.kind,
      duplicate: p.duplicate,
      bits: hamming(hashes.get(p.a.path) ?? '', hashes.get(p.b.path) ?? ''),
      similarity: Object.fromEntries(
        budgets.map((budget) => {
          const v = vectors.get(budget);
          const a = v?.get(p.a.path);
          const b = v?.get(p.b.path);
          return [budget, a && b ? dot(a, b) : 0];
        }),
      ),
    }));

    const t280 = duplicateThresholds(280);
    const reference280 = decide(pairs, 280, t280);
    const results = budgets.map((budget) => {
      const k = distanceScale(pairs, budget, 280);
      const fitted = scaledThresholds(t280, k);
      const configured = duplicateThresholds(budget);
      return {
        budget,
        distanceScale: Number(k.toFixed(4)),
        fittedThresholds: fitted,
        configuredThresholds: configured,
        margins: margins(pairs, budget),
        with280Thresholds: scoreRule(pairs, decide(pairs, budget, t280), reference280),
        withFitted: scoreRule(pairs, decide(pairs, budget, fitted), reference280),
        withConfigured: scoreRule(pairs, decide(pairs, budget, configured), reference280),
      };
    });
    const kinds = [...new Set(pairs.map((p) => p.kind))].map((kind) => ({
      kind,
      pairs: pairs.filter((p) => p.kind === kind).length,
      bits: pairs.filter((p) => p.kind === kind).map((p) => p.bits),
    }));
    const summary = { pairs: pairs.length, kinds: kinds.map((k) => [k.kind, k.pairs]) };
    process.stdout.write(`${[...results, summary].map((r) => JSON.stringify(r)).join('\n')}\n`);
    if (values.out)
      writeFileSync(
        values.out,
        `${JSON.stringify({ device: model.device, coreml: values.coreml, results, kinds, pairs }, null, 1)}\n`,
      );
    return 0;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

process.exitCode = await main();
