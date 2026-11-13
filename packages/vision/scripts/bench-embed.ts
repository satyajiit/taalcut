// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Embedding throughput on this Mac (P2-L9 against the P1-J2 budget):
 *
 *   pnpm --filter @taalcut/vision bench:embed [--model <dir>] [--frames 64] [--tokens 70|140|280]
 *     [--batch-tokens N] [--coreml <embeddinggemma-2-coreml dir>] [--json]
 *
 * Frames are real decodes of a synthetic 1080p clip, scaled by FFmpeg to the
 * processor size for the token budget (140: 768×384, 128 soft tokens; 280:
 * 1056×576, 264), embedded one at a time and then through the embedder's
 * queue (calls filled to the profile's token budget). The nightly job (P2-Q4)
 * runs it on the runners; the M1 figure comes from H9. Needs the
 * embeddinggemma-2 component folder. `--coreml` runs the mac helper's Core ML
 * model instead (IX2-E5; needs the helper, native/mac-helper/build.sh).
 */
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createBinaryResolver,
  runFfmpeg,
  softwareEncoderFor,
  videoEncodeFlags,
  type MediaContext,
} from '@taalcut/media';
import type { VisionEmbedder } from '../src/embed/embedder';
import { visionDtypeFor, type EmbeddingImage } from '../src/embed/model';
import { DEFAULT_EMBEDDING_PROFILE } from '../src/embed/profile';
import { IMAGE_TOKEN_BUDGETS, parseImageTokenBudget, type ImageTokenBudget } from '../src/embed/space';
import { probeSource, sampleFrames } from '../src/media/frames';
import { benchEmbedder } from './embed-frames/model';
import { timed } from './embed-frames/timing';

/** P1-J2: frames per second the M5 Max baseline must sustain (spike 02 measured 2.46 at batch 4). */
const BUDGET_FRAMES_PER_SECOND = 2.0;

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: fileURLToPath(new URL('../.cache/embeddinggemma-2', import.meta.url)) },
    frames: { type: 'string', default: '64' },
    tokens: { type: 'string', default: '280' },
    'batch-tokens': { type: 'string' },
    coreml: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

/** The flags as numbers; throws on one that names no budget. */
function budgets(): { imageTokens: ImageTokenBudget; batchTokens: number } {
  const imageTokens = parseImageTokenBudget(values.tokens);
  if (!imageTokens) throw new Error(`--tokens must be one of ${IMAGE_TOKEN_BUDGETS.join(', ')}`);
  const batchTokens = Number(values['batch-tokens'] ?? DEFAULT_EMBEDDING_PROFILE.batchTokens);
  if (!Number.isInteger(batchTokens) || batchTokens < 1)
    throw new Error('--batch-tokens is a positive integer');
  return { imageTokens, batchTokens };
}

/** `count` real decodes of a synthetic 1080p clip, at the embedder's frame size. */
async function benchFrames(
  media: MediaContext,
  dir: string,
  count: number,
  embedder: VisionEmbedder,
): Promise<EmbeddingImage[]> {
  const clip = join(dir, 'clip.mp4');
  const made = await runFfmpeg(media, [
    ...['-y', '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30`, '-frames:v', String(count * 3)],
    // Software H.264: the clip is not about the hardware encoder (brief: VideoToolbox stalls).
    ...videoEncodeFlags(softwareEncoderFor('h264', media.platform)!, 8_000_000, 30),
    clip,
  ]);
  if (!made.ok) throw new Error(made.error.detail ?? made.error.code);
  const source = await probeSource(media, clip);
  if (!source.ok) throw new Error(source.error.code);
  const size = await embedder.frameSize(source.value.width, source.value.height, 'index');
  const sampled = await sampleFrames(media, source.value, { size, format: 'rgb24', every: 3 });
  if (!sampled.ok) throw new Error(sampled.error.code);
  return sampled.value.slice(0, count).map((f) => ({ width: f.width, height: f.height, rgb: f.data }));
}

/** Load and first call, 16 frames one per call, all frames through the queue, 64 texts. */
async function measure(embedder: VisionEmbedder, images: readonly EmbeddingImage[]) {
  const must = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  };
  const warm = await timed(async () => must(await embedder.embedImages(images.slice(0, 4))));
  const single = images.slice(0, 16);
  const sequential = await timed(async () => {
    for (const image of single) must(await embedder.embedImages([image]));
  });
  const queued = await timed(async () => must(await embedder.embedImages(images)));
  const texts = Array.from(
    { length: 64 },
    (_, i) => `transcript segment ${i}: we walked along the beach at sunset`,
  );
  const text = await timed(async () => must(await embedder.embedTexts(texts, { purpose: 'document' })));
  return {
    loadAndWarmMs: Math.round(warm.ms),
    framesPerSecondSequential: Number((single.length / (sequential.ms / 1000)).toFixed(2)),
    framesPerSecondQueued: Number((images.length / (queued.ms / 1000)).toFixed(2)),
    textsPerSecondBatch16: Number((texts.length / (text.ms / 1000)).toFixed(1)),
  };
}

async function main(): Promise<number> {
  const modelDir = values.model;
  if (!existsSync(join(modelDir, 'onnx', 'model_q4.onnx_data'))) {
    console.error(`no embeddinggemma-2 component at ${modelDir} (see SPEC.md, "Live model runs")`);
    return 2;
  }
  const binaries = await createBinaryResolver({ development: true }).resolve();
  if (!binaries.ok) {
    console.error(`no FFmpeg: ${binaries.error.code}`);
    return 2;
  }
  const { imageTokens, batchTokens } = budgets();
  const fallbacks: string[] = [];
  // The helper resolves symlinks (/var is /private/var) before it checks its allowed root.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-bench-')));
  const native = values.coreml !== undefined;
  const embedder = await benchEmbedder({
    modelDir,
    tempDir: dir,
    imageTokens,
    batchTokens,
    onFallback: (reason) => fallbacks.push(reason),
    ...(values.coreml ? { coremlDir: values.coreml } : {}),
  });
  try {
    const images = await benchFrames(
      { binaries: binaries.value },
      dir,
      Math.max(8, Number(values.frames)),
      embedder,
    );
    const measured = await measure(embedder, images);
    const first = images[0];
    const result = {
      device: embedder.device(),
      visionDtype: native ? 'coreml-fp16-q4' : visionDtypeFor(modelDir),
      fallbacks,
      frameSize: first ? `${first.width}x${first.height}` : 'none',
      frames: images.length,
      imageTokens,
      batchTokens,
      ...measured,
      rssGiB: Number((process.memoryUsage().rss / 2 ** 30).toFixed(2)),
      budgetFramesPerSecond: BUDGET_FRAMES_PER_SECOND,
      meetsBudget: measured.framesPerSecondQueued >= BUDGET_FRAMES_PER_SECOND,
    };
    await embedder.close();
    if (values.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else
      for (const [key, value] of Object.entries(result))
        process.stdout.write(`${key.padEnd(28)} ${String(value)}\n`);
    return result.meetsBudget ? 0 : 1;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

process.exitCode = await main();
