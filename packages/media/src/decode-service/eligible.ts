// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which pictures the decode service reads exactly as FFmpeg's VideoToolbox route does (IX2-V3): 8-bit SDR
 * H.264 or HEVC, 4:2:0, decoded on VideoToolbox to NV12, at normal speed on the stream's own grid (no
 * conform repeating or dropping frames), not mirrored. The analysis pass (analysis-pass/helper-eligible.ts)
 * and explicit frame reads (frame-sets/service-frame-sets.ts) both ask it; anything else stays on FFmpeg.
 */
import type { NormalisationPlan } from '../normalise/types';

const CODECS: ReadonlySet<string> = new Set(['h264', 'hevc']);
const PICTURES: ReadonlySet<string> = new Set(['yuv420p', 'yuvj420p']);

/** Why the plan's picture isn't one the service gives FFmpeg's frames for, or undefined. */
export function pictureDecline(plan: NormalisationPlan): string | undefined {
  if (plan.kind !== 'video') return 'not_video';
  if (plan.decode.backend !== 'videotoolbox' || plan.decode.surfaceFormat !== 'nv12')
    return 'not_videotoolbox';
  if (plan.hdr !== 'none' || plan.toneMap !== 'none') return 'hdr';
  if ((plan.source.bitDepth ?? 8) > 8) return 'deep_colour';
  if (!PICTURES.has(plan.source.pixelFormat ?? '')) return 'pixel_format';
  if (!CODECS.has(plan.source.codec ?? '')) return 'codec';
  if (plan.mirrored) return 'mirrored';
  if (plan.source.vfr) return 'variable_rate';
  if (plan.speed.kind !== 'normal') return 'retimed';
  // The grid is the stream's own rate (snapped to its common fraction); the service checks every frame on it.
  const { native, output } = plan.frameRate;
  if (native && native.num * output.den !== output.num * native.den) return 'conformed_rate';
  return undefined;
}

/** The range FFmpeg's decoder tags the frames with: full for a `pc` (or `yuvj`) stream, else video. */
export function streamRange(plan: NormalisationPlan): 'full' | 'video' {
  return plan.source.colour.range === 'pc' || plan.source.pixelFormat === 'yuvj420p' ? 'full' : 'video';
}

/**
 * Helper failure codes that say the file is not one the service reads as FFmpeg does: later reads of it, passes and
 * frame reads alike, go to FFmpeg at once (`DecodeService.avoid`, this process). Any other failure
 * (`decode.failed`, `decode.output_closed`, a helper that exited) is the read's, not the file's: FFmpeg reads it
 * once, then the service is asked again (IX2-F16).
 */
const FILE_CODES: ReadonlySet<string> = new Set([
  'decode.unsupported',
  'decode.off_grid',
  'decode.unreadable',
  'decode.session_malfunction',
]);

export const avoidsFile = (code: string): boolean => FILE_CODES.has(code);
