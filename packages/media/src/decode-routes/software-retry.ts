// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A hardware decoder or encoder that won't start (IX2-F6, IX3-K4). Under load, or with another app holding the
 * Mac's sessions, VideoToolbox can refuse a session: FFmpeg prints "Failed setup for format videotoolbox_vld:
 * hwaccel initialisation returned error" (`cuda`, `d3d11`, … on other hwaccels), decodes in software instead, and
 * a graph built for hardware frames (`scale_vt`, `hwdownload`) then fails on the software ones; a hardware
 * encoder that gets no session fails to open. Every FFmpeg job on a hardware route runs through
 * `retryOnSoftwareRoute` (media's own jobs through `retryOnSoftware`, its plan-shaped layer; render's through
 * the route layer with its own routes): when that is why it failed, the job runs once more on its software
 * route, and the fallback is reported (media: `reportDecodeRoute`, operation `media.decode`; render: core's
 * `computeFallbackEvent`; reason `accelerator_failed`), never silent. A transient refusal is not remembered for
 * the format (`HardwareFailures`): the next job tries the hardware again.
 */
import type { AsyncResult, TaalcutError } from '@taalcut/core';
import type { ToneMapChoice } from '../backends';
import { reportDecodeRoute } from '../compute-report';
import type { MediaContext } from '../ffmpeg';
import { failedRoute, resolveTone } from '../normalise/session';
import type { NormalisationPlan } from '../normalise/types';

/** FFmpeg's line (libavcodec/decode.c, AV_LOG_ERROR, so it prints at `-loglevel error`). */
const WONT_START = /Failed setup for format ([\w.-]+): hwaccel initiali[sz]ation returned error/;

/**
 * FFmpeg's lines for a hardware decoder whose device won't open (fftools/ffmpeg_dec.c, AV_LOG_ERROR): no CUDA
 * device (`CUDA_VISIBLE_DEVICES=-1`, no NVIDIA driver), a render node that won't open. Recorded on the RTX 4090
 * host with the GPU hidden: "No device available for decoder: device type cuda needed for codec h264."
 */
const NO_DEVICE = /No device available for decoder: device type (\w+) needed/;

/**
 * FFmpeg's lines for a hardware encoder that gets no session, each at AV_LOG_ERROR: VideoToolbox
 * (libavcodec/videotoolboxenc.c, `vtenc_create_encoder`: "Cannot create compression session: <OSStatus>") and
 * NVENC (libavcodec/nvenc.c: "OpenEncodeSessionEx failed: <reason>"; recorded text, not run on Windows hardware).
 */
const ENCODER_WONT_START: readonly { readonly encoder: string; readonly line: RegExp }[] = [
  { encoder: 'VideoToolbox', line: /Cannot create compression session: (-?\d+)/ },
  { encoder: 'NVENC', line: /OpenEncodeSessionEx failed: ([^\n]*)/ },
  // libavcodec/nvenc.c with no usable device (recorded with CUDA_VISIBLE_DEVICES=-1): cuInit or cuCtxCreate.
  { encoder: 'NVENC', line: /\[\w+_nvenc @ [^\]]*\] [^\n]*(cu\w+\([^)]*\) failed -> [^\n]*)/ },
];

/** Why a job's failure says the hardware decoder wouldn't start, or undefined when it doesn't. */
export function hardwareWontStart(error: TaalcutError): string | undefined {
  const detail = error.detail ?? '';
  const format = WONT_START.exec(detail)?.[1];
  if (format !== undefined) return `the ${format} decoder would not start (hwaccel initialisation)`;
  const device = NO_DEVICE.exec(detail)?.[1];
  return device === undefined ? undefined : `the ${device} decoder would not start (no ${device} device)`;
}

/** Why a job's failure says the hardware encoder got no session, or undefined when it doesn't. */
export function hardwareEncoderWontStart(error: TaalcutError): string | undefined {
  for (const { encoder, line } of ENCODER_WONT_START) {
    const found = line.exec(error.detail ?? '');
    if (found) return `the ${encoder} encoder would not start (${found[1]?.trim() ?? ''})`;
  }
  return undefined;
}

/** The hardware decoder's or encoder's refusal, decoder first (it comes first in a run). */
export const hardwareRefused = (error: TaalcutError): string | undefined =>
  hardwareWontStart(error) ?? hardwareEncoderWontStart(error);

/** A job's two routes, of whatever shape its owner uses (a plan, render's decode and encode pair). */
export interface RouteRetry<R> {
  /** The route the job runs on first. */
  readonly first: R;
  /** The route without hardware, for a run that failed for `reason` on `first`. */
  readonly software: (reason: string) => R;
  /** Why a failure means the software route should run, or undefined when it doesn't. Default `hardwareRefused`. */
  readonly why?: (error: TaalcutError) => string | undefined;
  /** Whether the failed run left nothing the caller has already seen (default: nothing streams). */
  readonly untouched?: () => boolean;
  /** Reports the fallback, once, before the software run (`compute.fallback`). */
  readonly report: (reason: string, software: R) => void;
}

/** `run` on `first`, and once more on the software route when the hardware wouldn't start. */
export async function retryOnSoftwareRoute<R, T>(
  retry: RouteRetry<R>,
  run: (route: R) => AsyncResult<T>,
): AsyncResult<T> {
  const first = await run(retry.first);
  if (first.ok) return first;
  const reason = (retry.why ?? hardwareRefused)(first.error);
  if (reason === undefined || retry.untouched?.() === false) return first;
  const software = retry.software(reason);
  retry.report(reason, software);
  return run(software);
}

export interface SoftwareRetryOptions {
  /**
   * Why the failure means the software route should run instead, or undefined when it doesn't. Default
   * `hardwareWontStart`; conform also retries any FFmpeg failure on VideoToolbox.
   */
  readonly why?: (error: TaalcutError) => string | undefined;
  /**
   * Whether the failed run left nothing the caller has already seen (no frame streamed to it), so running the job
   * again can't hand anything out twice. Default: nothing streams.
   */
  readonly untouched?: () => boolean;
}

/** `run` on the plan's route, and once more on the software route when the hardware decoder wouldn't start. */
export function retryOnSoftware<T>(
  plan: NormalisationPlan,
  ctx: Pick<MediaContext, 'onComputeFallback'>,
  run: (plan: NormalisationPlan) => AsyncResult<T>,
  options: SoftwareRetryOptions = {},
): AsyncResult<T> {
  return retryOnSoftwareRoute<NormalisationPlan, T>(
    {
      first: plan,
      software: (reason) => ({ ...plan, decode: failedRoute(reason) }),
      why: options.why ?? hardwareWontStart,
      ...(options.untouched ? { untouched: options.untouched } : {}),
      report: (_reason, software) => reportDecodeRoute(ctx, software.decode),
    },
    run,
  );
}

/** Wraps a callback that hands something to the caller, counting `items` per call (default one). */
export type HandOutCounter = <A extends unknown[], R>(
  handOut: (...args: A) => R,
  items?: (...args: A) => number,
) => (...args: A) => R;

/**
 * `retryOnSoftware` for a job that streams to its caller (frames, samples): `run` wraps each callback that hands
 * something out with `counted`, and the job runs again only when the failed run handed nothing out, so the caller
 * never sees anything twice.
 */
export function retryStreaming<T>(
  plan: NormalisationPlan,
  ctx: Pick<MediaContext, 'onComputeFallback'>,
  run: (plan: NormalisationPlan, counted: HandOutCounter) => AsyncResult<T>,
): AsyncResult<T> {
  let handed = 0;
  const counted: HandOutCounter =
    (handOut, items = () => 1) =>
    (...args) => {
      handed += items(...args);
      return handOut(...args);
    };
  return retryOnSoftware(plan, ctx, (onRoute) => run(onRoute, counted), { untouched: () => handed === 0 });
}

/**
 * A decode job on its file's route: the tone map resolved, the route reported, and `run` on it, once more on the
 * software route when the hardware decoder won't start (`retryStreaming`: a run that handed the caller something
 * through `counted` isn't repeated).
 */
export async function onDecodeRoute<T>(
  source: NormalisationPlan,
  ctx: MediaContext,
  signal: AbortSignal | undefined,
  run: (plan: NormalisationPlan, toneMap: ToneMapChoice, counted: HandOutCounter) => AsyncResult<T>,
): AsyncResult<T> {
  const tone = await resolveTone(source, ctx, signal);
  if (!tone.ok) return tone;
  reportDecodeRoute(ctx, tone.value.plan.decode);
  return retryStreaming(tone.value.plan, ctx, (plan, counted) => run(plan, tone.value.tone, counted));
}
