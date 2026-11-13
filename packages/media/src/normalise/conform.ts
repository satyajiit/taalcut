// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One full-quality conformed file: upright, SDR, constant frame rate, optionally cropped.
 * A hardware decode failure is retried once on the software route. Frames stay on the GPU into the encoder
 * when it takes them (CUDA into NVENC) and no CPU filter runs.
 * The tone-map method stays the one `selectToneMap` already chose.
 */
import { stat } from 'node:fs/promises';
import { err, ok, type AsyncResult, type FrameRate } from '@taalcut/core';
import { aacEncoder } from '../audio-codec';
import { reportDecodeRoute, reportEncoderChoice } from '../compute-report';
import { hardwareWontStart, retryOnSoftware } from '../decode-routes/software-retry';
import { transcodeHoldsVideoSession } from '../decode-routes/video-session';
import { encoderForSize } from '../backends';
import { progressBackend, videoEncodeFlags } from '../encode-flags';
import { EncoderSelection, selectWorkingEncoder } from '../encoders';
import { fileParams, FfmpegFailed, UnsupportedMedia } from '../errors';
import { runFfmpeg, type MediaContext } from '../ffmpeg';
import { gopSize } from '../proxy/ladder';
import type { ProgressListener } from '../progress';
import { toMediaTime } from '../time-bridge';
import { checkCrop, type GraphCrop } from './crop';
import { measureDrift } from './drift';
import { graphInputArgs, normalisationGraph, type GraphRange } from './graph';
import { gist, resolveTone } from './session';
import { outputSize } from './size';
import type { NormalisationPlan } from './types';

export interface ConformOptions {
  readonly out: string;
  readonly range?: GraphRange;
  readonly maxLongSide?: number;
  /** Keep only this rectangle of the upright frame (even pixels); `maxLongSide` then applies to it. */
  readonly crop?: GraphCrop;
  readonly codec: 'h264' | 'hevc';
  readonly signal?: AbortSignal;
  readonly onProgress?: ProgressListener;
}

export interface ConformResult {
  readonly driftMs: number;
  readonly frames: number;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

function rateOf(rate: FrameRate): number {
  return rate.den === 0 ? 0 : rate.num / rate.den;
}

async function audioFlags(
  plan: NormalisationPlan,
  ctx: MediaContext,
  signal?: AbortSignal,
): AsyncResult<string[]> {
  if (!plan.audio) return ok([]);
  const encoder = await aacEncoder(ctx, signal);
  if (!encoder.ok) return encoder;
  return ok(['-c:a', encoder.value, '-b:a', '192k', '-ar', '48000']);
}

export async function conform(
  path: string,
  source: NormalisationPlan,
  ctx: MediaContext,
  options: ConformOptions,
): AsyncResult<ConformResult> {
  if (source.kind !== 'video') {
    return err(UnsupportedMedia(fileParams(path), { detail: 'conform writes a video file' }));
  }
  const crop = checkCrop(path, source, options.crop);
  if (!crop.ok) return crop;
  const tone = await resolveTone(source, ctx, options.signal);
  if (!tone.ok) return tone;
  const encCtx = ctx.encoders ? ctx : { ...ctx, encoders: new EncoderSelection() };
  const plan = tone.value.plan;
  const size = options.maxLongSide === undefined ? undefined : { longSide: options.maxLongSide };
  const pixels = outputSize(plan, size, crop.value);
  const selected = await selectWorkingEncoder(
    encCtx,
    options.codec,
    options.signal ? { signal: options.signal } : {},
  );
  if (!selected.ok) return selected;
  const chosen = encoderForSize(selected.value, pixels);
  if (!chosen.ok) return chosen;
  const fallback = chosen.value.fallbackReason;
  reportEncoderChoice(
    ctx,
    'media.encode',
    selected.value.encoder,
    chosen.value.encoder,
    fallback?.detail,
    fallback?.code,
  );
  const audio = await audioFlags(tone.value.plan, encCtx, options.signal);
  if (!audio.ok) return audio;
  const fps = Math.max(1, rateOf(plan.frameRate.output));
  const bps = Math.max(8_000_000, Math.round(pixels.width * pixels.height * fps * 0.15));
  const encoder = chosen.value.encoder;

  const run = (onRoute: NormalisationPlan) => {
    const route = onRoute.decode;
    const graph = normalisationGraph(onRoute, {
      route,
      toneMap: tone.value.tone,
      ...(size ? { size } : {}),
      ...(options.range ? { range: options.range } : {}),
      crop: crop.value,
      encoder,
    });
    const codecFlags = videoEncodeFlags(encoder, bps, gopSize(fps), {
      purpose: 'conform',
      ...(graph.deviceFrames ? { deviceFrames: true } : {}),
    });
    const duration = toMediaTime(options.range?.duration ?? plan.duration);
    const cut = plan.audio ? ['-shortest'] : [];
    return runFfmpeg(
      ctx,
      ['-y', ...graphInputArgs(path, onRoute, graph), ...codecFlags, ...audio.value, ...cut, options.out],
      {
        holdsVideoSession: transcodeHoldsVideoSession(route, encoder),
        timeoutMs: 180_000,
        backend: progressBackend(route),
        ...(options.onProgress ? { onProgress: options.onProgress, duration } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
  };

  reportDecodeRoute(ctx, plan.decode);
  // Any FFmpeg failure on a hardware decode runs the conform again on the software route, not only a decoder that
  // wouldn't start: a rate conform is the one copy of the file the app keeps (decode-routes/software-retry.ts).
  const encoded = await retryOnSoftware(plan, ctx, run, {
    // The decoder's own refusal when FFmpeg said so (no CUDA device, VideoToolbox setup), else FFmpeg's first lines.
    why: (error) =>
      error.code === 'media.ffmpeg_failed' && plan.decode.backend !== 'software'
        ? (hardwareWontStart(error) ?? gist(error.detail))
        : undefined,
  });
  return encoded.ok ? measured(options.out, ctx, options.signal) : encoded;
}

/** The written file's drift and size. */
async function measured(out: string, ctx: MediaContext, signal?: AbortSignal): AsyncResult<ConformResult> {
  const drifted = await measureDrift(out, ctx, signal);
  if (!drifted.ok) return drifted;
  try {
    const bytes = (await stat(out)).size;
    return ok({ ...drifted.value, bytes });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'conform output missing';
    return err(FfmpegFailed({ exitCode: -1 }, { detail }));
  }
}
