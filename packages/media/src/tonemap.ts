// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HDR (HLG, PQ, Dolby Vision) to SDR bt709, GPU first (ADR 0002, spike 07):
 * libplacebo's `bt.2446a` curve on Vulkan, which on a Mac is the bundled
 * MoltenVK and on Linux the system loader with the GPU's own driver. CPU zscale + `tonemap=hable` runs only when the Vulkan device
 * can't start, and the reason is reported. `selectToneMap` proves the GPU
 * route with a one-frame trial, like `selectWorkingEncoder`; MediaService
 * remembers the answer (`ToneMapSelection`), so the trial runs once.
 */
import { ok, type AsyncResult, type Result } from '@taalcut/core';
import {
  failureGist,
  reportFallback,
  type FallbackReason,
  type ToneMapChoice,
  type ToneMapOptions,
} from './backends';
import { reportToneMapCpu } from './compute-report';
import { shipsVulkanDriver } from './binaries/build-targets';
import { detectFilters } from './filters';
import { runFfmpeg, type MediaContext, type ToneMapCache } from './ffmpeg';
import type { VideoStreamInfo } from './probe/types';

export type { ToneMapChoice, ToneMapMethod, ToneMapOptions } from './backends';

/** libplacebo to SDR bt709, limited range, applying a Dolby Vision RPU when there is one (spike 07). */
export const LIBPLACEBO_TONEMAP =
  'libplacebo=format=yuv420p:color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv' +
  ':tonemapping=bt.2446a:apply_dolbyvision=1';

/** One frame of an HLG-tagged pattern through LIBPLACEBO_TONEMAP: proves the Vulkan device starts. */
export const TONEMAP_TRIAL_ARGS: readonly string[] = [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=64x64:rate=1',
  '-frames:v',
  '1',
  '-vf',
  `format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv,${LIBPLACEBO_TONEMAP}`,
  '-f',
  'null',
  '-',
];

const ZSCALE_TRANSFERS = new Set(['arib-std-b67', 'smpte2084']);
const ZSCALE_PRIMARIES = new Set(['bt2020', 'bt709', 'smpte431', 'smpte432']);
const ZSCALE_MATRICES = new Set(['bt2020nc', 'bt2020c', 'bt709']);

/** The input transfer for zscale: the probed one, else what the Dolby Vision base layer is compatible with. */
function hdrTransfer(video: Pick<VideoStreamInfo, 'colour' | 'dolbyVision'>): string {
  const transfer = video.colour.transfer;
  if (transfer && ZSCALE_TRANSFERS.has(transfer)) return transfer;
  return video.dolbyVision?.compatibilityId === 4 ? 'arib-std-b67' : 'smpte2084';
}

/**
 * The filters that map `video` to SDR with `choice`, for after the decode
 * (and after `hwdownload` on the VideoToolbox route). Colour names come from
 * ffprobe but go into a filter graph, so only known names pass.
 */
export function toneMapFilters(
  choice: ToneMapChoice,
  video: Pick<VideoStreamInfo, 'colour' | 'dolbyVision'>,
): string[] {
  if (choice.method === 'libplacebo') return [LIBPLACEBO_TONEMAP];
  if (choice.method === 'none') return [];
  const pick = (value: string | undefined, allowed: Set<string>, fallback: string) =>
    value && allowed.has(value) ? value : fallback;
  const primaries = pick(video.colour.primaries, ZSCALE_PRIMARIES, 'bt2020');
  const matrix = pick(video.colour.space, ZSCALE_MATRICES, 'bt2020nc');
  return [
    `zscale=tin=${hdrTransfer(video)}:pin=${primaries}:min=${matrix}:t=linear:npl=100`,
    'format=gbrpf32le',
    'tonemap=tonemap=hable:desat=0',
    'zscale=p=bt709:t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ];
}

/**
 * The tone-map to use: libplacebo when the build has it and a Vulkan device
 * starts, else zscale + hable with the reason, reported to
 * `ctx.onBackendFallback`. `method: 'none'` only when the build has neither.
 */
export async function selectToneMap(
  ctx: MediaContext,
  options: ToneMapOptions = {},
): AsyncResult<ToneMapChoice> {
  const signal = options.signal ? { signal: options.signal } : {};
  const filters = await detectFilters(ctx, signal);
  if (!filters.ok) return filters;
  const cpu = filters.value.has('zscale') && filters.value.has('tonemap');
  const fallback = (reason: FallbackReason): Result<ToneMapChoice> => {
    const choice: ToneMapChoice = cpu
      ? { method: 'zscale', backend: 'software', curve: 'hable', fallbackReason: reason }
      : {
          method: 'none',
          backend: 'software',
          fallbackReason: {
            code: 'filter_missing',
            detail: `${reason.detail}; no zscale and tonemap either`,
          },
        };
    reportFallback(ctx.onBackendFallback, {
      operation: 'tonemap',
      subject: 'hdr',
      reason: choice.fallbackReason!,
    });
    reportToneMapCpu(ctx, choice.fallbackReason!.code, choice.fallbackReason!.detail);
    return ok(choice);
  };

  if (options.software) return fallback({ code: 'requested', detail: 'CPU tone-map requested' });
  if (!filters.value.has('libplacebo'))
    return fallback({ code: 'filter_missing', detail: 'libplacebo is not in this FFmpeg build' });
  if (!ctx.binaries.vulkanIcd && shipsVulkanDriver(ctx.platform ?? process.platform))
    return fallback({ code: 'vulkan_unavailable', detail: 'no bundled MoltenVK ICD next to this FFmpeg' });
  const trial = await runFfmpeg(ctx, TONEMAP_TRIAL_ARGS, {
    // libplacebo on Vulkan: GPU compute, no video decoder or encoder session.
    holdsVideoSession: false,
    timeoutMs: options.timeoutMs ?? 30_000,
    ...signal,
  });
  if (trial.ok) return ok({ method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' });
  if (trial.error.code === 'media.cancelled') return trial;
  // The first line of the detail is the exit code; FFmpeg's own lines follow.
  const stderr = (trial.error.detail ?? trial.error.code).split('\n').slice(1).join('\n');
  return fallback({ code: 'vulkan_unavailable', detail: failureGist(stderr || trial.error.code) });
}

/**
 * Remembers one `selectToneMap` answer for a MediaService: whether Vulkan
 * starts doesn't change while the app runs. A failed or cancelled selection
 * is not remembered, and a requested software selection is never stored.
 */
export class ToneMapSelection implements ToneMapCache {
  private choice: Promise<Result<ToneMapChoice>> | undefined;

  get(ctx: MediaContext, options: ToneMapOptions = {}): AsyncResult<ToneMapChoice> {
    if (options.software) return selectToneMap(ctx, options);
    if (!this.choice) {
      const choice = selectToneMap(ctx, options);
      this.choice = choice;
      void choice.then((result) => {
        if (!result.ok && this.choice === choice) this.choice = undefined;
      });
    }
    return this.choice;
  }
}
