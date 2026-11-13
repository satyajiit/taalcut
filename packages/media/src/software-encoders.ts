// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { EncodeCodec } from './hw-video/types';

/** A route identifier, resolved to h264_videotoolbox + -require_sw 1 by videoEncodeFlags. */
export const SOFTWARE_VIDEOTOOLBOX_H264 = 'h264_videotoolbox_software';

const ENCODERS: Readonly<Record<EncodeCodec, readonly string[]>> = {
  h264: ['libopenh264'],
  hevc: [],
  av1: ['libsvtav1'],
  prores: ['prores_ks'],
};

/** CPU routes by platform. macOS uses Apple's installed codec; OpenH264 remains for Linux/older builds. */
export function softwareEncodersFor(codec: EncodeCodec, platform: NodeJS.Platform): readonly string[] {
  return platform === 'darwin' && codec === 'h264'
    ? [SOFTWARE_VIDEOTOOLBOX_H264, ...ENCODERS.h264]
    : ENCODERS[codec];
}

/** The CPU fallback route; feed it through videoEncodeFlags, not directly to FFmpeg. */
export function softwareEncoderFor(
  codec: EncodeCodec,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return softwareEncodersFor(codec, platform)[0];
}

/** Resolve our explicit software route to the encoder listed by FFmpeg. */
export function ffmpegEncoderName(encoder: string): string {
  return encoder === SOFTWARE_VIDEOTOOLBOX_H264 ? 'h264_videotoolbox' : encoder;
}
