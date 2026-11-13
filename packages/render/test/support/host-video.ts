// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The host's video routes, for tests (LNX1-RND). Fixtures are inputs, not the route under test: on a Mac they stay
 * on VideoToolbox as they always were, elsewhere OpenH264 makes them (in every LGPL build, and no NVENC session
 * taken from a render running beside the suite). Tests that assert the route a job took ask `hostVideo` what this
 * machine has: media's proven rows and its working H.264 encoder, the same answers render plans with.
 */
import { err, ok } from '@taalcut/core';
import {
  backendOfEncoder,
  hwVideoBackend,
  NoEncoder,
  machineVideoBackends,
  selectWorkingEncoder,
  type EncodeCodec,
  type HardwareBackend,
  type MediaContext,
} from '@taalcut/media';

/** The H.264 encoder fixtures are made with. */
export const FIXTURE_H264 = process.platform === 'darwin' ? 'h264_videotoolbox' : 'libopenh264';

export interface HostVideo {
  /** The machine's first decoding row ('videotoolbox', 'cuda'), or undefined: decodes run in software. */
  readonly decode: HardwareBackend | undefined;
  /** Whether that row decodes stills (VideoToolbox does; NVDEC does not, media's row). */
  readonly decodesStills: boolean;
  /** The working H.264 encoder ('h264_videotoolbox', 'h264_nvenc', 'libopenh264'). */
  readonly encoder: string;
  /** Whether the encoder is a hardware one. */
  readonly hardwareEncode: boolean;
}

export async function hostVideo(ctx: MediaContext): Promise<HostVideo> {
  const machine = await machineVideoBackends(ctx);
  if (!machine.ok) throw new Error(`machine rows: ${machine.error.code}`);
  const decode = machine.value.backends.find((id) => hwVideoBackend(id).decode !== undefined);
  const encoder = await selectWorkingEncoder(ctx, 'h264');
  if (!encoder.ok) throw new Error(`encoder: ${encoder.error.code}`);
  return {
    decode,
    decodesStills: decode !== undefined && hwVideoBackend(decode).decode?.stills !== false,
    encoder: encoder.value.encoder,
    hardwareEncode: encoder.value.fallbackReason === undefined,
  };
}

/**
 * A fixed encoder answer, for unit tests that run no FFmpeg: `h264` (and `hevc`, `av1`) as media's working pick,
 * with no fallback; a CPU encoder (libopenh264, libsvtav1) carries media's `requested` reason, as a forced-CPU
 * machine's pick does.
 */
export function knownEncoders(encoders: {
  readonly h264: string;
  readonly hevc?: string;
  readonly av1?: string;
}): NonNullable<MediaContext['encoders']> {
  const choice = (codec: EncodeCodec) => {
    const encoder = codec === 'prores' ? 'prores_ks' : encoders[codec];
    if (!encoder) return err(NoEncoder({ codec }, { detail: `no ${codec} encoder` }));
    const row = backendOfEncoder(encoder);
    return ok({
      codec,
      encoder,
      backend: row ? row.id : 'software',
      ...(row ? {} : { fallbackReason: { code: 'requested', detail: 'hardware turned off' } as const }),
    } as const);
  };
  return {
    detect: () =>
      Promise.resolve(err(NoEncoder({ codec: 'h264' }, { detail: 'fixed answer: no detection' }))),
    select: (_ctx, codec) => Promise.resolve(choice(codec)),
  };
}
