// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hardware video engine a machine decodes and encodes with, from its probed facts: VideoToolbox on
 * every Mac (Apple Silicon and Intel); on Linux NVDEC/NVENC on an NVIDIA GPU CUDA can open (FFmpeg's `cuda`
 * hwaccel and NVENC open the GPU through CUDA, so CUDA_VISIBLE_DEVICES hides them too), else VA-API on an Intel
 * or AMD GPU with a render node (LNX1); elsewhere the primary GPU's own engine (NVIDIA NVENC/NVDEC, Intel Quick
 * Sync, AMD AMF). A forced-CPU machine (TAALCUT_FORCE_CPU) has none. Media's hardware session cap is chosen by
 * it (round IX); the names match media's `HARDWARE_VIDEO_ENGINES`.
 */
import type { GpuVendor, HardwareInfo } from './types';

export const VIDEO_ENGINES = ['videotoolbox', 'nvidia', 'intel', 'amd', 'vaapi', 'none'] as const;
export type VideoEngine = (typeof VIDEO_ENGINES)[number];

const BY_VENDOR: Readonly<Record<GpuVendor, VideoEngine>> = {
  apple: 'videotoolbox',
  nvidia: 'nvidia',
  intel: 'intel',
  amd: 'amd',
  other: 'none',
};

export function hardwareVideoEngine(info: HardwareInfo): VideoEngine {
  if (info.platform === 'darwin') return 'videotoolbox';
  if (info.forcedCpu) return 'none';
  if (info.platform === 'linux') {
    if (info.gpus.some((g) => g.vendor === 'nvidia' && g.apis.includes('cuda'))) return 'nvidia';
    const vaapi = info.gpus.some((g) => (g.vendor === 'intel' || g.vendor === 'amd') && g.renderNode);
    return vaapi ? 'vaapi' : 'none';
  }
  const gpu = info.gpus[0];
  return gpu ? BY_VENDOR[gpu.vendor] : 'none';
}
