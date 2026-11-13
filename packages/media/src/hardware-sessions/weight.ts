// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How many hardware sessions one FFmpeg command opens, read from its
 * arguments: one per hardware decode (`-hwaccel`), one per hardware encoder,
 * and one for GPU filter work (libplacebo on Vulkan, `*_vulkan` filters) or a
 * bare `-init_hw_device`. Zero means the command needs no slot. Pure, so the
 * counting rules are tested without a process.
 *
 * NVIDIA is the exception: its cap is on NVENC sessions (limits.ts), and NVDEC has none, so a CUDA decode
 * (`-hwaccel cuda`) and CUDA filter work (`scale_cuda`, a `cuda` device) take no slot; only NVENC does. What
 * bounds concurrent NVDEC decodes is the job engine's video class and the VRAM budget, not this gate.
 */

/** FFmpeg's hardware encoders carry the platform in the name: h264_videotoolbox, hevc_nvenc, … */
const HARDWARE_ENCODER = /_(videotoolbox|nvenc|qsv|amf|mf|vaapi|v4l2m2m|vulkan|d3d12va)$/;
/** -c:v, -codec:v, -c:v:0, -vcodec and a bare -c / -codec. */
const CODEC_FLAG = /^-(?:c|codec)(?::v(?::\d+)?)?$|^-vcodec$/;
/** Flags whose value is a filter graph. */
const FILTER_FLAG = /^-(?:vf|filter(?::v)?(?::\d+)?|filter_complex|lavfi)$/;
/** GPU filters that do not come with a hardware decode: libplacebo, and Vulkan filters. */
const GPU_FILTER = /\blibplacebo\b|\b[a-z0-9]+_vulkan\b/;
/** Hardware decodes outside the cap: NVDEC through CUDA. */
const UNCAPPED_DECODES = new Set(['none', 'cuda']);
/** `-init_hw_device cuda`, `cuda=name`, `cuda=name:0`: CUDA compute, not a video engine session. */
const UNCAPPED_DEVICE = /^cuda(?:[=:]|$)/;

function softwareOnlyVideoToolbox(args: readonly string[]): boolean {
  // Our CPU fallback has one video output and explicitly forbids hardware. Keep multi-output commands
  // conservative: a require_sw option scoped to one output must never hide another output's GPU session.
  const requireSoftware = args.lastIndexOf('-require_sw');
  return (
    requireSoftware !== -1 &&
    args[requireSoftware + 1] === '1' &&
    args.filter((arg) => CODEC_FLAG.test(arg)).length === 1
  );
}

function usesHardwareEncoder(arg: string, value: string | undefined, softwareVideoToolbox: boolean): boolean {
  if (!CODEC_FLAG.test(arg) || value === undefined || !HARDWARE_ENCODER.test(value)) return false;
  return value !== 'h264_videotoolbox' || !softwareVideoToolbox;
}

export function hardwareSessionWeight(args: readonly string[]): number {
  const softwareVideoToolbox = softwareOnlyVideoToolbox(args);
  let decodes = 0;
  let encodes = 0;
  let gpuFilters = false;
  let initDevice = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const value = args[i + 1];
    if (arg === '-hwaccel' && value !== undefined && !UNCAPPED_DECODES.has(value)) decodes++;
    else if (usesHardwareEncoder(arg, value, softwareVideoToolbox)) encodes++;
    else if (FILTER_FLAG.test(arg) && value !== undefined && GPU_FILTER.test(value)) gpuFilters = true;
    else if (arg === '-init_hw_device' && value !== undefined && !UNCAPPED_DEVICE.test(value))
      initDevice = true;
  }
  const weight = decodes + encodes + (gpuFilters ? 1 : 0);
  // A device opened for filters alone (hwupload, scale_vt on uploaded frames) is still GPU work.
  return weight === 0 && initDevice ? 1 : weight;
}
