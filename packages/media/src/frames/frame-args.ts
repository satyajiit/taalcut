// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ffmpeg arguments for one frame, on a hardware row or the CPU.
 *
 * Hardware (hw-video rows): frames stay on the device (`-hwaccel_output_format
 * videotoolbox_vld`, `cuda`), so FFmpeg's autorotate can't touch them; rotation
 * and scaling run there instead (`transpose_vt`/`scale_vt`, `transpose_cuda`/
 * `scale_cuda`), then `hwdownload` names the exact surface format the decoder
 * produced. Only the final pixel conversion for the image encoder runs on the CPU.
 *
 * Software: FFmpeg's autorotate, then `scale`.
 *
 * Either route, for an HDR source: the tone-map filters last (libplacebo on
 * Vulkan, or zscale + hable on the CPU), so the frame is SDR bt709.
 */
import type { HardwareBackend } from '../hw-video/types';
import {
  hwDecodeArgs,
  hwDownloadFilters,
  hwScaleFilter,
  hwUprightFilters,
  turnsOnDevice,
} from '../hw-video/filters';
import { fileInput, stillPipeDemuxer, USER_MEDIA_INPUT } from '../input';
import { ONE_THREAD_SCALES } from '../normalise/one-thread';
import { toMicroseconds } from '../rational';
import type { RationalTime } from '../rational-time';

export type FrameFormat = 'jpeg' | 'png';

export interface FrameOutput {
  /** Default 'jpeg'. PNG is always 8-bit RGB. */
  readonly format?: FrameFormat;
  /** Longest side in pixels, keeping aspect ratio. Never upscales. */
  readonly maxDimension?: number;
  /** FFmpeg JPEG quality scale, 2 (best) to 31. Default 3. */
  readonly jpegQuality?: number;
}

export type FrameRoute =
  | { readonly backend: 'software' }
  | {
      readonly backend: HardwareBackend;
      /** The format `hwdownload` must name (the plan's, from the row's `surfaceFormat`). */
      readonly surfaceFormat: string;
      /** Clockwise degrees, from the probe. */
      readonly rotation: 0 | 90 | 180 | 270;
      /** Displayed size from the probe; without it the scale runs on the CPU after download. */
      readonly displaySize?: { readonly width: number; readonly height: number };
    };

/** '1.001000': exact microseconds as decimal seconds, which every FFmpeg version parses. */
export function seekArg(at: RationalTime): string {
  const micros = toMicroseconds(at);
  return `${Math.floor(micros / 1_000_000)}.${String(micros % 1_000_000).padStart(6, '0')}`;
}

/**
 * The size `scale=min(m,iw):min(m,ih):force_original_aspect_ratio=decrease`
 * gives, computed the same way (FFmpeg's av_rescale rounding), so both routes
 * produce the same dimensions.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { readonly width: number; readonly height: number } {
  const rescale = (a: number, b: number, c: number) => Math.floor((a * b + Math.floor(c / 2)) / c);
  const w = Math.min(max, width);
  const h = Math.min(max, height);
  return {
    width: Math.max(1, Math.min(w, rescale(h, width, height))),
    height: Math.max(1, Math.min(h, rescale(w, height, width))),
  };
}

function cpuScale(maxDimension: number): string {
  const m = String(maxDimension);
  return `scale='min(${m},iw)':'min(${m},ih)':force_original_aspect_ratio=decrease`;
}

type HardwareRoute = Exclude<FrameRoute, { readonly backend: 'software' }>;

/** On a device: rotate and scale there, then download (a CPU scale only without a display size). */
function deviceSteps(route: HardwareRoute, max: number | undefined): string[] {
  // The rotation is applied here, so the display matrix must not travel on: the PNG encoder
  // would write it as EXIF orientation and viewers would rotate the frame a second time.
  if (!turnsOnDevice(route.backend)) {
    // A device that can't turn or scale (D3D11VA): download, then FFmpeg's CPU filters.
    const turn = { 0: [], 90: ['transpose=1'], 180: ['hflip', 'vflip'], 270: ['transpose=2'] }[
      route.rotation
    ];
    const steps = [
      ...hwUprightFilters(route.backend, 0),
      ...hwDownloadFilters(route.backend, route.surfaceFormat),
    ];
    return [...steps, ...turn, ...(max !== undefined ? [cpuScale(max)] : [])];
  }
  const steps = hwUprightFilters(route.backend, route.rotation);
  const display = route.displaySize;
  const fit = max !== undefined && display ? fitWithin(display.width, display.height, max) : undefined;
  if (fit && display && (fit.width !== display.width || fit.height !== display.height))
    steps.push(hwScaleFilter(route.backend, fit.width, fit.height)!);
  steps.push(...hwDownloadFilters(route.backend, route.surfaceFormat));
  if (max !== undefined && !display) steps.push(cpuScale(max));
  return steps;
}

/**
 * A PNG of a frame the device sized (no CPU scale, no tone map) only converts on the CPU: on one thread, so it
 * repeats (IX2-F15, normalise/one-thread.ts).
 */
function onlyConverts(output: FrameOutput, route: FrameRoute, toneMap: readonly string[]): boolean {
  if (output.format !== 'png' || toneMap.length > 0 || route.backend === 'software') return false;
  if (!turnsOnDevice(route.backend)) return false;
  return output.maxDimension === undefined || route.displaySize !== undefined;
}

/**
 * The -vf chain. `toneMap` (HDR sources, see tonemap.ts) runs after the
 * download and after any CPU scale, so it maps as few pixels as possible.
 */
function filterChain(output: FrameOutput, route: FrameRoute, toneMap: readonly string[]): string[] {
  const max = output.maxDimension;
  const chain = route.backend !== 'software' ? deviceSteps(route, max) : [];
  if (route.backend === 'software' && max !== undefined) chain.push(cpuScale(max));
  chain.push(...toneMap);
  // 10-bit sources would otherwise give a 16-bit PNG, which vision models don't need.
  if (output.format === 'png') chain.push('format=rgb24');
  const oneThread = onlyConverts(output, route, toneMap) ? ONE_THREAD_SCALES : '';
  return chain.length > 0 ? ['-vf', `${oneThread}${chain.join(',')}`] : [];
}

/** ffmpeg arguments (after the prelude) for one frame of `path` at `at`; `toneMap` from `toneMapFilters`. */
export function frameArgs(
  path: string,
  at: RationalTime,
  output: FrameOutput = {},
  route: FrameRoute = { backend: 'software' },
  toneMap: readonly string[] = [],
): string[] {
  const still = stillPipeDemuxer(path);
  const codec =
    output.format === 'png' ? ['-c:v', 'png'] : ['-c:v', 'mjpeg', '-q:v', String(output.jpegQuality ?? 3)];
  const hardware = route.backend !== 'software' ? hwDecodeArgs(route.backend) : [];
  return [
    ...USER_MEDIA_INPUT,
    ...hardware,
    '-ss',
    seekArg(at),
    ...(still ? ['-f', still] : []),
    '-i',
    fileInput(path),
    // 'V' (capital) skips cover art and thumbnail tracks.
    '-map',
    '0:V:0',
    '-frames:v',
    '1',
    '-an',
    '-sn',
    '-dn',
    ...filterChain(output, route, toneMap),
    '-f',
    'image2pipe',
    ...codec,
    'pipe:1',
  ];
}
