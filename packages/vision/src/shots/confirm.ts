// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two methods for a cut: scdet's peak (and its shape), then the
 * embedding distance between the frames around it. Shared by user-footage
 * shots (P2-L7) and the breakdown's cuts (P2-T4).
 */
import { ok, type AsyncResult, type Result } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { VISION_CONFIG } from '../config';
import type { VisionEmbedder } from '../embed/embedder';
import { cosineDistance } from '../embed/space';
import type { FrameSource } from '../media/frame-source';
import { sampleFrames, type SampledFrame, type VideoSource } from '../media/frames';
import type { SceneSample } from '../media/scene';

export interface Located {
  readonly frame: number;
  readonly score: number;
  /**
   * The picture changed and changed straight back, as with a flash: the frame
   * after the peak differs a lot from its predecessor (MAFD), and the one
   * after that doesn't. scdet scores only the first change, so its score
   * alone can't tell a flash from a cut; busy footage after a real cut keeps
   * its MAFD up and isn't flash-shaped.
   */
  readonly flashLike: boolean;
}

/** The highest score in a full-grid window, with its flash shape. */
export function locate(samples: readonly SceneSample[]): Located | undefined {
  let best: SceneSample | undefined;
  for (const sample of samples) if (!best || sample.score > best.score) best = sample;
  if (!best) return undefined;
  const peak = best;
  const ratio = VISION_CONFIG.shots.flashMafdRatio;
  const next = samples.find((s) => s.index === peak.index + 1);
  const after = samples.find((s) => s.index === peak.index + 2);
  const flashLike =
    next !== undefined &&
    peak.mafd > 0 &&
    next.mafd >= ratio * peak.mafd &&
    (after === undefined || after.mafd < ratio * next.mafd);
  return { frame: peak.index, score: peak.score, flashLike };
}

export interface PairDeps {
  readonly media: MediaContext;
  readonly embedder?: VisionEmbedder;
  /** The asset's frame source (cached frames, one decode per seek window); absent: frames are sampled here. */
  readonly frames?: FrameSource;
}

/**
 * Cosine distance between frame c − before and frame c + after for each
 * candidate c: one decode pass, one embedding run. Frames a little away from
 * the cut keep a one-frame flash from looking like a change. Undefined where
 * a frame is past the end; all undefined without an embedder.
 */
export async function pairDistances(
  candidates: readonly { readonly frame: number }[],
  source: VideoSource,
  deps: PairDeps,
  signal: AbortSignal | undefined,
  offsets: { readonly before: number; readonly after: number } = VISION_CONFIG.cuts,
): AsyncResult<(number | undefined)[]> {
  const embedder = deps.embedder;
  if (!embedder || candidates.length === 0) return ok(candidates.map(() => undefined));
  const last = (source.frameCount ?? Number.MAX_SAFE_INTEGER) - 1;
  const pairs = candidates.map(
    (c) => [Math.max(0, c.frame - offsets.before), Math.min(last, c.frame + offsets.after)] as const,
  );
  const vectors = await frameVectors(
    pairs.flat(),
    source,
    { media: deps.media, embedder, ...(deps.frames ? { frames: deps.frames } : {}) },
    signal,
  );
  if (!vectors.ok) return vectors;
  return ok(
    pairs.map(([a, b]) => {
      const va = vectors.value.get(a);
      const vb = vectors.value.get(b);
      return va && vb ? cosineDistance(va, vb) : undefined;
    }),
  );
}

/**
 * Frames read and embedded at once from a frame source. Their RGB stays alive until the model has embedded every
 * one, so a clip with hundreds of cut candidates held hundreds of model-size frames per job (IX-F3); a chunk bounds
 * that (48 frames at 1056×576 is about 88 MB). The source reads from its cache, or decodes per seek window, either
 * way. Without a source, one sampling run reads them all: a chunk would be another decode.
 */
const SOURCE_CHUNK = 48;

type FrameDeps = {
  readonly media: MediaContext;
  readonly embedder: VisionEmbedder;
  readonly frames?: FrameSource;
};

/** One chunk's vectors, keyed by frame. */
async function embedFrames(
  frames: readonly number[],
  source: VideoSource,
  size: { readonly width: number; readonly height: number },
  deps: FrameDeps,
  signal: AbortSignal | undefined,
): AsyncResult<[number, Float32Array][]> {
  const sampled: Result<SampledFrame[]> = deps.frames
    ? await deps.frames.frames({ size, format: 'rgb24', frames }, signal)
    : await sampleFrames(deps.media, source, {
        size,
        format: 'rgb24',
        frames,
        ...(signal ? { signal } : {}),
      });
  if (!sampled.ok) return sampled;
  const vectors = await deps.embedder.embedImages(
    sampled.value.map((frame) => ({ width: frame.width, height: frame.height, rgb: frame.data })),
    signal ? { signal } : {},
  );
  if (!vectors.ok) return vectors;
  return ok(sampled.value.map((frame, i) => [frame.index, vectors.value[i]!]));
}

/** Embeddings of grid frames, keyed by frame (frames past the end are missing). */
export async function frameVectors(
  frames: readonly number[],
  source: VideoSource,
  deps: FrameDeps,
  signal: AbortSignal | undefined,
): AsyncResult<Map<number, Float32Array>> {
  const size = await deps.embedder.frameSize(source.width, source.height);
  const chunk = deps.frames ? SOURCE_CHUNK : Math.max(1, frames.length);
  const vectors = new Map<number, Float32Array>();
  for (let at = 0; at < frames.length; at += chunk) {
    const embedded = await embedFrames(frames.slice(at, at + chunk), source, size, deps, signal);
    if (!embedded.ok) return embedded;
    for (const [frame, vector] of embedded.value) vectors.set(frame, vector);
  }
  return ok(vectors);
}
