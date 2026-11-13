// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Soft cuts: dissolves, fades and whips, which scdet barely sees because the
 * picture changes a little on every frame. Frames sampled at
 * `cuts.softScanFps` are embedded. A jump between neighbours with no hard cut
 * near it is a soft cut when the distance is ≥ `cuts.softDistance`, or when
 * it is a smaller jump (≥ SOFT_CANDIDATE_DISTANCE) that the pixels confirm:
 * the frames between really are blends of the two shots, or dip to black, or
 * blur through a whip. It is placed where the crossfade passes half, and
 * stays disputed unless the jump is ≥ `cuts.softConfirmDistance`. Its
 * `transition` is set only when the pixels showed one.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { VISION_CONFIG } from '../config';
import type { VisionEmbedder } from '../embed/embedder';
import { cosineDistance } from '../embed/space';
import { fitLongSide, sampleFrames, type SampledFrame, type VideoSource } from '../media/frames';
import { frameVectors } from '../shots/confirm';
import { softEvidence } from './transition';
import { plainTime, type BreakdownCut } from './types';

export interface SoftScanOptions {
  readonly scanFps: number;
  /** Grid frames [start, end). */
  readonly start: number;
  readonly end: number;
  readonly signal?: AbortSignal;
}

/**
 * The smallest embedding jump looked at with pixels. EmbeddingGemma 2 puts
 * unrelated synthetic patterns only 0.10–0.35 apart, so `softDistance` alone
 * misses dissolves between them; the blend check keeps motion inside a shot out.
 */
export const SOFT_CANDIDATE_DISTANCE = 0.15;
/** Thumbnails for the pixel checks: small, gray, every frame of the span. */
const THUMB_LONG_SIDE = 96;

const cfg = VISION_CONFIG.cuts;

export interface Span {
  readonly from: number;
  readonly to: number;
  readonly distance: number;
}

export async function softCuts(
  source: VideoSource,
  hardCuts: readonly number[],
  embedder: VisionEmbedder,
  media: MediaContext,
  options: SoftScanOptions,
): AsyncResult<BreakdownCut[]> {
  const fps = source.rate.num / source.rate.den;
  const step = Math.max(1, Math.round(fps / Math.max(options.scanFps, 0.1)));
  const frames: number[] = [];
  for (let f = options.start; f < options.end; f += step) frames.push(f);
  if (frames.length < 2) return ok([]);
  const signal = options.signal;
  const vectors = await frameVectors(frames, source, { media, embedder }, signal);
  if (!vectors.ok) return vectors;

  const cuts: BreakdownCut[] = [];
  for (const span of jumps(frames, vectors.value, hardCuts)) {
    // One more sample on each side (not past a hard cut), so the whole transition sits inside.
    const before = Math.max(...hardCuts.filter((h) => h <= span.from), options.start);
    const after = Math.min(...hardCuts.filter((h) => h > span.to).map((h) => h - 1), options.end - 1);
    const from = Math.max(before, span.from - step);
    const to = Math.min(after, span.to + step);
    const thumbs = await spanThumbs(source, media, from, to, signal);
    if (!thumbs.ok) {
      if (thumbs.error.code === 'core.cancelled') return thumbs;
      continue;
    }
    const evidence = softEvidence(thumbs.value);
    if (!evidence) continue;
    const pixels = evidence.blend || evidence.transition !== 'dissolve';
    if (span.distance < cfg.softDistance && !pixels) continue;
    cuts.push({
      frame: evidence.frame,
      at: plainTime(evidence.frame, source.rate),
      kind: 'soft',
      // Named only when the pixels show it; a jump in embeddings alone says "soft", not which kind.
      ...(pixels ? { transition: evidence.transition } : {}),
      method: 'embedding',
      status: span.distance >= cfg.softConfirmDistance ? 'confirmed' : 'disputed',
      confidence: Math.min(1, span.distance / (cfg.softConfirmDistance * 1.2) + (pixels ? 0.15 : 0)),
      distance: span.distance,
    });
  }
  return ok(cuts);
}

/** Neighbour jumps ≥ SOFT_CANDIDATE_DISTANCE with no hard cut near them; adjacent jumps merge into one span. */
export function jumps(
  frames: readonly number[],
  vectors: ReadonlyMap<number, Float32Array>,
  hardCuts: readonly number[],
): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i + 1 < frames.length; i++) {
    const a = frames[i] as number;
    const b = frames[i + 1] as number;
    const va = vectors.get(a);
    const vb = vectors.get(b);
    if (!va || !vb) continue;
    const distance = cosineDistance(va, vb);
    if (distance < SOFT_CANDIDATE_DISTANCE) continue;
    // A hard cut between the samples (or within 2 frames) explains the jump.
    if (hardCuts.some((h) => h > a - 2 && h <= b + 2)) continue;
    const last = spans[spans.length - 1];
    if (last && last.to === a) {
      spans[spans.length - 1] = { from: last.from, to: b, distance: Math.max(last.distance, distance) };
    } else spans.push({ from: a, to: b, distance });
  }
  return spans;
}

function spanThumbs(
  source: VideoSource,
  media: MediaContext,
  from: number,
  to: number,
  signal: AbortSignal | undefined,
): AsyncResult<SampledFrame[]> {
  const frames: number[] = [];
  for (let f = from; f <= to; f++) frames.push(f);
  return sampleFrames(media, source, {
    size: fitLongSide(source.width, source.height, THUMB_LONG_SIDE),
    format: 'gray',
    frames,
    ...(signal ? { signal } : {}),
  });
}
