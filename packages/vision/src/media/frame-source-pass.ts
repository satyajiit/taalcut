// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The frame source's whole-file analysis pass (IX-D2): media's
 * `runAnalysisPass`, or for a long video `runSegmentedPass` (IX-D7), with
 * the frames the request keeps sized to the cache's room and handed to it.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import {
  bytesPerFrame,
  lcm,
  passSegments,
  runAnalysisPass,
  runSegmentedPass,
  SEGMENT_MIN_SECONDS,
  SEGMENT_SECONDS,
  type NormalisationPlan,
  type PassFrame,
  type PassFrameSet,
  type PassSegment,
  type RgbBatch,
} from '@taalcut/media';
import type { PassRequest, PassResult } from './frame-source';
import type { FrameFormat } from './frames';
import { frameSetName, keepFiles, mediaSize, type SourceContext } from './frame-source-reads';

/** Of the cache's per-asset bound, the share frames a pass keeps may take (the rest is for later stages' frames). */
const PASS_SHARE = 0.75;

const rawFormat = (format: FrameFormat): 'gray8' | 'rgb24' => (format === 'gray' ? 'gray8' : 'rgb24');

/**
 * A long video's pass in segments (IX-D7): from SEGMENT_MIN_SECONDS (10 min) and with room for more than one
 * decode, up to `parallel` segments of at least SEGMENT_SECONDS, starting on every sampling's multiples, each
 * decoding two samples (and at least one statistics sample, and the stream's context) early.
 */
function segmentsFor(
  plan: NormalisationPlan,
  request: PassRequest,
  keeps: readonly { readonly every: number }[],
): PassSegment[] {
  const parallel = request.parallel ?? 1;
  const fps = plan.frameRate.output.num / plan.frameRate.output.den;
  if (plan.kind !== 'video' || parallel < 2 || plan.frames / fps < SEGMENT_MIN_SECONDS) return [];
  const coarse = request.coarseEvery ?? 1;
  const stream = request.stream;
  const align = lcm([coarse, request.align ?? 1, stream?.every ?? 1, ...keeps.map((k) => k.every)]);
  return passSegments(plan.frames, {
    count: parallel,
    minFrames: Math.round(SEGMENT_SECONDS * fps),
    align,
    preRoll: Math.max(2 * coarse, request.align ?? 1, 2, stream ? stream.context * stream.every : 0),
  });
}

/** The frame sets the pass keeps, each capped at an even share of the room the asset has left in the cache. */
function passKeeps(ctx: SourceContext, request: PassRequest): PassFrameSet[] {
  const room = Math.max(0, ctx.cache.limits.assetBytes * PASS_SHARE - ctx.frames.bytes);
  const keep = request.keep ?? [];
  return keep.map((k) => {
    const each = bytesPerFrame(rawFormat(k.format), k.size.width, k.size.height);
    return {
      set: frameSetName(k.size, k.format),
      size: mediaSize(k.size),
      format: rawFormat(k.format),
      every: k.every,
      maxFrames: each > 0 ? Math.floor(room / keep.length / each) : 0,
    };
  });
}

/** One decode of the whole file (segments side by side for a long one); its kept frames go to the cache. */
export async function runPass(
  ctx: SourceContext,
  request: PassRequest,
  signal: AbortSignal | undefined,
): AsyncResult<PassResult> {
  const { path, plan } = ctx.input;
  const keeps = passKeeps(ctx, request);
  const common = {
    size: request.longSide,
    ...(request.coarseEvery !== undefined ? { coarseEvery: request.coarseEvery } : {}),
    // Every black run, however short (IX3-D2: a fade's black lasts frames); freezes at FFmpeg's 2 s, as before.
    detectMinSeconds: { black: 0 },
    ...ctx.decode,
    ...(ctx.decodeService ? { decodeService: ctx.decodeService } : {}),
    ...(signal ? { signal } : {}),
  };
  const segments = segmentsFor(plan, request, keeps);
  const stream = request.stream;
  const run =
    segments.length > 1
      ? await runSegmentedPass(path, plan, ctx.media, {
          ...common,
          segments,
          parallel: request.parallel ?? 1,
          ...(request.onFrame ? { onFrame: request.onFrame } : {}),
          ...(stream ? { rgbStream: stream } : {}),
          frameSets: keeps.map((k) => ({ ...k, maxFrames: Math.floor(k.maxFrames / segments.length) })),
        })
      : await runAnalysisPass(path, plan, ctx.media, {
          ...common,
          ...(request.onFrame ? { onFrame: (frame: PassFrame) => request.onFrame?.(frame, 0) } : {}),
          ...(stream
            ? { rgbStream: { ...stream, onFrames: (batch: RgbBatch) => stream.onFrames(batch, 0) } }
            : {}),
          frameSets: keeps,
        });
  if (!run.ok) return run;
  const kept = await keepFiles(ctx, run.value.files);
  if (!kept.ok) return kept;
  const { fine, coarse, black, freeze, frames } = run.value;
  const owned = segments.length > 1 ? segments : [{ start: 0, end: frames }];
  return ok({ fine, coarse, black, freeze, frames, segments: owned });
}
