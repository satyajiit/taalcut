// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The FFmpeg routes of a grade (LNX1-RND), on media's hardware video table like the conform (engine/video-route.ts):
 * the segment decodes on the machine's decoder and encodes on its working H.264 encoder, the frames coming down to
 * the CPU for the filter (`-hwaccel` without an output format). Two filters:
 *
 * - Vulkan: libplacebo applies the cube (`lut=`, `lut_type=normalized`: to the decoded, still non-linear R′G′B′,
 *   the encoding the cube was fitted in) and writes BT.709 limited 4:2:0 back, no dithering. Measured on the RTX 4090
 *   against the CPU route on a lossless output: 52 dB PSNR, at most 9 code values apart at hard chroma edges
 *   (chroma upsampling differs), ΔE00 within the grade's bar (test/grade/apply-grade.int.test.ts). `native` and
 *   `conversion` apply it to the wrong encoding (19 dB, 12 dB). libplacebo picks the discrete GPU itself.
 * - CPU: zscale to full-range R′G′B′ (16 bit), `lut3d` tetrahedral, zscale back (colour-filters.ts).
 *
 * The Vulkan route's gate is media's tone-map trial (`selectToneMap`, remembered by `ctx.toneMaps`): libplacebo in
 * the build and a Vulkan device that starts.
 */
import { ok, type AsyncResult, type ComputeBackend } from '@taalcut/core';
import {
  filterPathArg,
  hwVideoBackend,
  selectToneMap,
  videoEncodeFlags,
  type MediaContext,
} from '@taalcut/media';
import { planVideoRoute, type PlannedRoute, type VideoRoute } from '../engine/video-route';
import { bt709ToRgbFilter, RGB_TO_BT709_FILTER } from './colour-filters';

/** What the Vulkan route asks for, in a fallback's `wanted`. */
export const VULKAN_GRADE: readonly ComputeBackend[] = ['vulkan'];

/** The CPU route's graph: limited YUV → full-range R′G′B′ (16 bit), the cube, back to limited BT.709 4:2:0. */
export function cpuGradeFilter(cubePath: string): string {
  return [
    bt709ToRgbFilter(),
    `lut3d=file=${filterPathArg(cubePath)}:interp=tetrahedral`,
    RGB_TO_BT709_FILTER,
  ].join(',');
}

/** The Vulkan route's graph: libplacebo applies the cube to normalized R′G′B′ and writes BT.709 limited 4:2:0. */
export function vulkanGradeFilter(cubePath: string): string {
  return (
    `libplacebo=lut=${filterPathArg(cubePath)}:lut_type=normalized:format=yuv420p` +
    ':colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:dithering=none'
  );
}

/** Whether the Vulkan route runs: true, or why not (media's tone-map trial). */
export async function vulkanGrade(
  ctx: MediaContext,
  signal?: AbortSignal,
): AsyncResult<true | { readonly detail: string; readonly unavailable: boolean }> {
  const choice = await selectToneMap(ctx, signal ? { signal } : {});
  if (!choice.ok) return choice;
  if (choice.value.method === 'libplacebo') return ok(true);
  const reason = choice.value.fallbackReason;
  return ok({
    detail: reason?.detail ?? 'libplacebo on Vulkan is not available',
    unavailable: reason?.code !== 'requested',
  });
}

/** A conformed segment, as the conform writes it: 8-bit H.264 4:2:0. */
const SEGMENT_VIDEO = { codec: 'h264', profile: 'High', pixelFormat: 'yuv420p' } as const;

/** The grade's first route: the machine's decoder and working H.264 encoder (`render.gradeDecode`, `…Encode`). */
export function planGradeRoute(ctx: MediaContext, signal?: AbortSignal): AsyncResult<PlannedRoute> {
  return planVideoRoute(ctx, {
    video: SEGMENT_VIDEO,
    codec: 'h264',
    operation: 'render.grade',
    ...(signal ? { signal } : {}),
  });
}

export interface GradeEncode {
  readonly segment: string;
  /** The conform's mezzanine bitrate. */
  readonly bitrateKbps: number;
  /** Keyframe interval in frames (the conform uses one a second; default 30). */
  readonly gopFrames?: number;
}

/** One grade run: decode on the route's row (frames to the CPU), the filter, encode with the row's flags. */
export function gradeArgs(input: GradeEncode, out: string, route: VideoRoute, filter: string): string[] {
  const decode =
    route.decode.backend === 'software' ? undefined : hwVideoBackend(route.decode.backend).decode;
  return [
    '-y',
    ...(decode ? ['-hwaccel', decode.hwaccel] : []),
    '-i',
    input.segment,
    '-map',
    '0:v:0',
    '-vf',
    filter,
    '-fps_mode',
    'passthrough',
    // The encoder's row's flags (media): no software escape on a hardware encoder, so a refused session fails into
    // the logged OpenH264 retry (IX3-F5, M5); BT.709 tags and VUI.
    ...videoEncodeFlags(route.encoder, Math.round(input.bitrateKbps) * 1000, input.gopFrames ?? 30, {
      purpose: 'conform',
    }),
    '-an',
    out,
  ];
}
