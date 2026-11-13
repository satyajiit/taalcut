// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What this machine encodes in hardware (LNX1-AV1): each codec's working hardware encoder. The answer is
 * `selectWorkingEncoder`'s, proven by the same trial encode and remembered with it (`ctx.encoders`), so an RTX 30
 * (`av1_nvenc` compiled in, its trial refused) has no AV1 and an RTX 40 has `av1_nvenc`. Asking reports no
 * `compute.fallback`: nothing is encoded on the CPU by asking. Render offers its AV1 presets, and an HEVC choice,
 * only where this names an encoder.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import type { EncodeCodec } from './backends';
import { selectWorkingEncoder } from './encoders';
import type { MediaContext } from './ffmpeg';

/** The codecs an export can be in, in the order they are asked about. */
export const HARDWARE_ENCODE_CODECS = ['h264', 'hevc', 'av1'] as const satisfies readonly EncodeCodec[];
export type HardwareEncodeCodec = (typeof HARDWARE_ENCODE_CODECS)[number];

/** Each codec's working hardware encoder by FFmpeg name: `{ h264: 'h264_nvenc', hevc: 'hevc_nvenc', av1: 'av1_nvenc' }`. */
export type HardwareEncoders = Readonly<Partial<Record<HardwareEncodeCodec, string>>>;

const quietly = () => undefined;

export async function hardwareEncoders(
  ctx: MediaContext,
  options: { readonly signal?: AbortSignal; readonly codecs?: readonly HardwareEncodeCodec[] } = {},
): AsyncResult<HardwareEncoders> {
  const asking: MediaContext = { ...ctx, onBackendFallback: quietly };
  const found: Partial<Record<HardwareEncodeCodec, string>> = {};
  for (const codec of options.codecs ?? HARDWARE_ENCODE_CODECS) {
    const choice = await selectWorkingEncoder(
      asking,
      codec,
      options.signal ? { signal: options.signal } : {},
    );
    // No encoder at all (HEVC on a machine without hardware: the LGPL build has no CPU HEVC) is a "no" here.
    if (!choice.ok && choice.error.code === 'media.no_encoder') continue;
    if (!choice.ok) return choice;
    if (choice.value.backend !== 'software') found[codec] = choice.value.encoder;
  }
  return ok(found);
}
