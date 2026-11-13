// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Short-GOP H.264 proxy. A preview-friendly original under the bitrate floor
 * is reused and nothing is written. A file over 15% of the original is
 * encoded once more at 64 kb/s audio, then kept with `overBudget`.
 *
 * A run that may hold a hardware video session says so (IX3-K2). When the
 * hardware refuses a session (the decoder's or the encoder's, before the
 * run wrote anything: VideoToolbox, NVDEC/NVENC), the encode runs once more with neither: software
 * decode and the platform CPU encoder, the same flags (closed 0.5 s GOP, size, colour
 * tags), the fallback reported as `compute.fallback` (IX3-K4). On NVIDIA the
 * frames stay on the GPU from NVDEC through scale_cuda into NVENC.
 */
import { statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { RationalTime, err, ok, type AsyncResult, type FrameRate as Rate } from '@taalcut/core';
import { aacEncoder } from '../audio-codec';
import { encoderForSize, softwareEncoderFor, type ToneMapChoice } from '../backends';
import type { DerivedFileRef } from '@taalcut/core';
import { reportDecodeRoute, reportEncoderChoice } from '../compute-report';
import { retryOnSoftwareRoute } from '../decode-routes/software-retry';
import { transcodeHoldsVideoSession } from '../decode-routes/video-session';
import { derivedKey, isContentHash } from '../cache/layout';
import { progressBackend, videoEncodeFlags } from '../encode-flags';
import { EncoderSelection, isHardwareEncoder, selectWorkingEncoder } from '../encoders';
import { fileParams, FfmpegFailed, UnsupportedMedia } from '../errors';
import { runFfmpeg, type MediaContext } from '../ffmpeg';
import type { ProcessOutput } from '../process/runner';
import { graphInputArgs, normalisationGraph } from '../normalise/graph';
import { failedRoute, resolveTone } from '../normalise/session';
import { outputSize } from '../normalise/size';
import type { NormalisationPlan } from '../normalise/types';
import type { ProgressListener } from '../progress';
import { toMediaTime } from '../time-bridge';
import {
  PROXY_AUDIO_BPS,
  PROXY_AUDIO_RETRY_BPS,
  PROXY_RECIPE,
  chooseProxyLadder,
  gopSize,
  isPreviewFriendly,
  proxyRate,
} from './ladder';

export interface ProxyRequest {
  readonly out: string;
  readonly sizeBytes: number;
  readonly contentHash?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: ProgressListener;
}

export interface ProxyResult {
  readonly file?: DerivedFileRef;
  readonly reusedOriginal: boolean;
  readonly ratio: number;
  readonly overBudget: boolean;
  readonly warnings: readonly string[];
}

const BUDGET = 0.15;

/** A proxy encode's route: the plan it decodes on and its video encoder. */
interface ProxyRoute {
  readonly plan: NormalisationPlan;
  readonly encoder: string;
}

/** The route without the hardware, for a run it refused a session (`reason`): software decode and the platform CPU encoder. */
function softwareRoute(route: ProxyRoute, reason: string, platform?: NodeJS.Platform): ProxyRoute {
  const decode = route.plan.decode.backend === 'software' ? route.plan.decode : failedRoute(reason);
  return {
    plan: { ...route.plan, decode },
    encoder: isHardwareEncoder(route.encoder) ? softwareEncoderFor('h264', platform)! : route.encoder,
  };
}

/** The failed run wrote nothing: FFmpeg opens (and empties) the file before its encoder starts. */
function nothingWritten(out: string): boolean {
  try {
    return statSync(out).size === 0;
  } catch {
    return true;
  }
}

async function fileSize(path: string): AsyncResult<number> {
  try {
    return ok((await stat(path)).size);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'proxy output missing';
    return err(FfmpegFailed({ exitCode: -1 }, { detail }));
  }
}

export async function makeProxy(
  path: string,
  source: NormalisationPlan,
  ctx: MediaContext,
  request: ProxyRequest,
): AsyncResult<ProxyResult> {
  if (source.kind !== 'video') {
    return err(UnsupportedMedia(fileParams(path), { detail: 'a proxy is a video file' }));
  }
  const durationSec = Math.max(0, RationalTime.toSeconds(source.duration));
  const rate = proxyRate(source);
  const fps = rate.den === 0 ? 1 : rate.num / rate.den;
  const ladder = chooseProxyLadder({
    sizeBytes: request.sizeBytes,
    durationSec,
    fps,
    sourceLongSide: Math.max(source.source.displayWidth, source.source.displayHeight),
    previewFriendly: isPreviewFriendly(source, path),
  });
  if (ladder.reusedOriginal) {
    return ok({ reusedOriginal: true, ratio: 1, overBudget: false, warnings: source.warnings });
  }
  const tone = await resolveTone(source, ctx, request.signal);
  if (!tone.ok) return tone;
  const encCtx = ctx.encoders ? ctx : { ...ctx, encoders: new EncoderSelection() };
  const plan = tone.value.plan;
  const pixels = outputSize(plan, { longSide: ladder.longSide });
  const selected = await selectWorkingEncoder(encCtx, 'h264', request.signal ? { signal: request.signal } : {});
  if (!selected.ok) return selected;
  const chosen = encoderForSize(selected.value, pixels);
  if (!chosen.ok) return chosen;
  const fallback = chosen.value.fallbackReason;
  reportEncoderChoice(ctx, 'media.encode', selected.value.encoder, chosen.value.encoder, fallback?.detail, fallback?.code);
  reportDecodeRoute(ctx, plan.decode);
  const audioName = plan.audio ? await aacEncoder(encCtx, request.signal) : undefined;
  if (audioName && !audioName.ok) return audioName;
  const encode = proxyEncoder(
    ctx,
    {
      path,
      request,
      toneMap: tone.value.tone,
      longSide: ladder.longSide,
      videoBps: ladder.videoBps,
      gop: gopSize(fps),
      rate,
      audioEncoder: audioName?.ok ? audioName.value : undefined,
    },
    { plan, encoder: chosen.value.encoder },
  );
  const first = await encode(PROXY_AUDIO_BPS);
  if (!first.ok) return first;
  let bytes = await fileSize(request.out);
  if (!bytes.ok) return bytes;
  let overBudget = request.sizeBytes > 0 && bytes.value > request.sizeBytes * BUDGET;
  if (overBudget && plan.audio) {
    const second = await encode(PROXY_AUDIO_RETRY_BPS);
    if (!second.ok) return second;
    bytes = await fileSize(request.out);
    if (!bytes.ok) return bytes;
    overBudget = request.sizeBytes > 0 && bytes.value > request.sizeBytes * BUDGET;
  }
  const ratio = request.sizeBytes > 0 ? bytes.value / request.sizeBytes : 0;
  const file =
    request.contentHash && isContentHash(request.contentHash)
      ? {
          kind: 'proxy' as const,
          key: derivedKey('proxy', request.contentHash, PROXY_RECIPE, 'mp4'),
          bytes: bytes.value,
          mimeType: 'video/mp4' as const,
          width: pixels.width,
          height: pixels.height,
          duration: plan.duration,
          frameRate: rate,
          recipe: PROXY_RECIPE,
        }
      : undefined;
  return ok({
    ...(file ? { file } : {}),
    reusedOriginal: false,
    ratio,
    overBudget,
    warnings: plan.warnings,
  });
}

/** What every encode of one proxy shares: only the route and the audio bitrate change between its runs. */
interface ProxyEncode {
  readonly path: string;
  readonly request: ProxyRequest;
  readonly toneMap: ToneMapChoice;
  readonly longSide: number;
  readonly videoBps: number;
  readonly gop: number;
  readonly rate: Rate;
  readonly audioEncoder: string | undefined;
}

/**
 * The proxy's encoder: each call encodes at `audioBps` on the route the last one finished on (the hardware's at
 * first), and once more without the hardware when it refused a session and the run wrote nothing.
 */
function proxyEncoder(
  ctx: MediaContext,
  job: ProxyEncode,
  first: ProxyRoute,
): (audioBps: number) => AsyncResult<ProcessOutput> {
  let route = first;
  return (audioBps) =>
    retryOnSoftwareRoute(
      {
        first: route,
        software: (reason) => softwareRoute(route, reason, ctx.platform),
        untouched: () => nothingWritten(job.request.out),
        report: (reason, software) => reportSoftwareRoute(ctx, route, software, reason),
      },
      async (onRoute) => {
        const ran = await encodeOn(ctx, job, onRoute, audioBps);
        if (ran.ok) route = onRoute;
        return ran;
      },
    );
}

/** One run of the proxy's encode on `route`. */
function encodeOn(
  ctx: MediaContext,
  job: ProxyEncode,
  { plan, encoder }: ProxyRoute,
  audioBps: number,
): AsyncResult<ProcessOutput> {
  const { request } = job;
  const graph = normalisationGraph(plan, {
    route: plan.decode,
    toneMap: job.toneMap,
    size: { longSide: job.longSide },
    fps: job.rate,
    encoder,
  });
  const audio =
    plan.audio && job.audioEncoder
      ? ['-c:a', job.audioEncoder, '-b:a', `${Math.round(audioBps / 1000)}k`]
      : [];
  return runFfmpeg(
    ctx,
    [
      '-y',
      ...graphInputArgs(job.path, plan, graph),
      ...videoEncodeFlags(encoder, job.videoBps, job.gop, {
        purpose: 'proxy',
        ...(graph.deviceFrames ? { deviceFrames: true } : {}),
      }),
      ...audio,
      request.out,
    ],
    {
      holdsVideoSession: transcodeHoldsVideoSession(plan.decode, encoder),
      timeoutMs: 180_000,
      backend: progressBackend(plan.decode),
      ...(request.onProgress ? { onProgress: request.onProgress, duration: toMediaTime(plan.duration) } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    },
  );
}

/** The software run's fallbacks: the decode (`media.decode`) and the encoder (`media.encode`) that moved. */
function reportSoftwareRoute(ctx: MediaContext, from: ProxyRoute, to: ProxyRoute, reason: string): void {
  if (to.plan.decode !== from.plan.decode) reportDecodeRoute(ctx, to.plan.decode);
  if (to.encoder !== from.encoder) reportEncoderChoice(ctx, 'media.encode', from.encoder, to.encoder, reason);
}
