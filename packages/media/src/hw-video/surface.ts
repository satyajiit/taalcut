// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The software format each hardware decoder hands its frames back in, which `hwdownload` must name exactly, from
 * the stream's pixel format. Undefined means the decoder can't carry that format, so the plan takes the CPU with
 * `format_unsupported` before any run.
 */
import { pixelFormatBitDepth } from '../probe/pixel-formats';

/** log2 chroma subsampling (width, height) and alpha, from a planar or semi-planar format name. */
export function layoutOf(pixelFormat: string): { w: number; h: number; alpha: boolean } | undefined {
  const base = pixelFormat.replace(/(le|be)$/, '');
  const yuv = /^yuv(a|j)?(4\d\d)p/.exec(base);
  const subsampling: Record<string, [number, number]> = {
    '444': [0, 0],
    '440': [0, 1],
    '422': [1, 0],
    '420': [1, 1],
    '411': [2, 0],
    '410': [2, 2],
  };
  if (yuv) {
    const [w, h] = subsampling[yuv[2] ?? ''] ?? [];
    return w === undefined || h === undefined ? undefined : { w, h, alpha: yuv[1] === 'a' };
  }
  if (/^(gbrp|gray)/.test(base)) return { w: 0, h: 0, alpha: false };
  if (/^gbrap/.test(base)) return { w: 0, h: 0, alpha: true };
  if (/^(nv12|p01\d)$/.test(base)) return { w: 1, h: 1, alpha: false };
  if (/^(nv16|p21\d)$/.test(base)) return { w: 1, h: 0, alpha: false };
  if (/^(nv24|p41\d)$/.test(base)) return { w: 0, h: 0, alpha: false };
  return undefined;
}

function depthAndLayout(pixelFormat: string | undefined) {
  if (!pixelFormat) return undefined;
  const depth = pixelFormatBitDepth(pixelFormat);
  const layout = layoutOf(pixelFormat);
  return depth === undefined || !layout ? undefined : { depth, layout };
}

/**
 * VideoToolbox. Mirrors FFmpeg's choice (libavcodec/videotoolbox.c): alpha → AYUV, deeper than 10 bits →
 * P216/P416, 4:4:4 → NV24/P410, 4:2:2 → NV16/P210, else NV12/P010.
 */
export function videoToolboxSurfaceFormat(pixelFormat: string | undefined): string | undefined {
  const found = depthAndLayout(pixelFormat);
  if (!found) return undefined;
  const { depth, layout } = found;
  if (layout.alpha) return depth > 8 ? 'ayuv64le' : 'ayuv';
  if (depth > 10) return layout.w === 0 ? 'p416le' : 'p216le';
  if (layout.w === 0) return depth > 8 ? 'p410le' : 'nv24';
  if (layout.h === 0) return depth > 8 ? 'p210le' : 'nv16';
  return depth > 8 ? 'p010le' : 'nv12';
}

/**
 * NVDEC through `-hwaccel cuda` (libavcodec/nvdec.c's sw formats): 4:2:0 → NV12, P010 or P016 by depth; 4:4:4 →
 * YUV444P or YUV444P16. 4:2:2 is left out (NVDEC decodes it from Blackwell on; the RTX 4090 can't), as are alpha
 * and gray, and H.264 deeper than 8 bits (NVDEC has no High 10 H.264).
 */
export function cudaSurfaceFormat(
  codec: string | undefined,
  pixelFormat: string | undefined,
): string | undefined {
  const found = depthAndLayout(pixelFormat);
  if (!found || found.layout.alpha) return undefined;
  const { depth, layout } = found;
  if (codec === 'h264' && depth > 8) return undefined;
  if (layout.w === 1 && layout.h === 1) return depth > 10 ? 'p016le' : depth > 8 ? 'p010le' : 'nv12';
  if (layout.w === 0 && layout.h === 0 && !/^(gbr|gray)/.test(pixelFormat ?? ''))
    return depth > 8 ? 'yuv444p16le' : 'yuv444p';
  return undefined;
}

/** VA-API: 4:2:0 only, NV12 or P010 (what every driver exports for decode surfaces). */
export function vaapiSurfaceFormat(pixelFormat: string | undefined): string | undefined {
  const found = depthAndLayout(pixelFormat);
  if (!found || found.layout.alpha || found.layout.w !== 1 || found.layout.h !== 1) return undefined;
  if (found.depth > 10) return undefined;
  return found.depth > 8 ? 'p010le' : 'nv12';
}

/** D3D11VA (slot, not run): NV12 or P010 for 4:2:0, like VA-API. */
export const d3d11vaSurfaceFormat = vaapiSurfaceFormat;
