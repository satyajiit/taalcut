// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * NVDEC through CUDA, the `cuda` row of hw-video (run on the RTX 4090 Linux host; on Windows profiles only its
 * arguments are tested). Frames stay in CUDA memory (`-hwaccel cuda -hwaccel_output_format cuda`), are turned
 * with `transpose_cuda` before the split and scaled per branch with `scale_cuda`, then downloaded in their own
 * format (CUDA can't convert on the way down: NV12, P010, P016, YUV444P[16]); an HDR source downloads and
 * tone-maps once before the split. Both filters are FFmpeg's CUDA video filters, built with
 * `--enable-cuda-llvm` (LGPL, no nonfree flag); `scale_npp` and `transpose_npp` need libnpp (nonfree) and are
 * never used. `-hwaccel cuda` runs FFmpeg's own decoder, which skips non-key pictures before NVDEC sees them;
 * never `h264_cuvid`/`hevc_cuvid`, which ignore skip_frame.
 */
import { hwDecoder } from '../hw-video/filters';
import type { DecodeRoute } from './route';
import { surfaceRoute } from './surface-route';

/** The route for a plan's CUDA decode, downloading in its surface format. */
export function cudaRoute(surfaceFormat: string): DecodeRoute {
  return surfaceRoute({ backend: 'cuda', surfaceFormat });
}

/**
 * A Windows NVIDIA profile's route for a plan that names no row: the surface the cuda row gives the plan's source
 * (8-bit 4:2:0 out as NV12, 10-bit as P010); by depth when the row has none for it.
 */
export const nvdecRoute: DecodeRoute = surfaceRoute({
  backend: 'cuda',
  surfaceFormat: (plan) =>
    hwDecoder('cuda').surfaceFormat(plan.source) ?? ((plan.source.bitDepth ?? 8) > 8 ? 'p010le' : 'nv12'),
});
