// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which export codecs this machine can write (LNX1-AV1), from media's `hardwareEncoders` (each codec's working
 * hardware encoder, trial-proven once per MediaService). H.264 always can: OpenH264 is the CPU route. HEVC needs a
 * hardware encoder (the LGPL build has no CPU HEVC). AV1 needs one too, by the owner's rule (2026-10-27): SVT-AV1
 * on the CPU is only the fallback when a hardware AV1 encode fails at run time, never a route chosen up front.
 */
import { err, ok, type AsyncResult, type ExportPreset, type ExportVideoCodec } from '@taalcut/core';
import { hardwareEncoders, type HardwareEncoders, type MediaContext } from '@taalcut/media';
import { CodecUnavailable } from '../errors';
import { presetCodecs } from './presets.v1';

/** Why a codec can't be used here: the export picker's words (render.unavailable.*). */
export const CODEC_REASON_KEYS: Readonly<Record<Exclude<ExportVideoCodec, 'h264'>, string>> = {
  hevc: 'render.unavailable.noHevcEncoder',
  av1: 'render.unavailable.noAv1Encoder',
};

export interface CodecAvailability {
  readonly codec: ExportVideoCodec;
  readonly available: boolean;
  readonly reasonKey?: string;
}

/** Whether `codec` can be encoded on a machine with these hardware encoders. */
export function codecAvailability(codec: ExportVideoCodec, hardware: HardwareEncoders): CodecAvailability {
  if (codec === 'h264' || hardware[codec] !== undefined) return { codec, available: true };
  return { codec, available: false, reasonKey: CODEC_REASON_KEYS[codec] };
}

/** Each of the preset's codecs on this machine, in the preset's order. */
export function presetCodecAvailability(
  presetValue: ExportPreset,
  hardware: HardwareEncoders,
): CodecAvailability[] {
  return presetCodecs(presetValue).map((codec) => codecAvailability(codec, hardware));
}

/**
 * The machine's hardware encoders; none when FFmpeg can't list them (the export would fail on its own then, with
 * FFmpeg's reason). Asking reports no compute fallback.
 */
export async function machineEncoders(media: MediaContext): Promise<HardwareEncoders> {
  const found = await hardwareEncoders(media);
  return found.ok ? found.value : {};
}

/**
 * Refuses an export in a codec this machine can't encode before anything renders (`render.codec_unavailable`, with
 * the reason key the picker shows); H.264 never waits for the question.
 */
export async function checkExportCodec(media: MediaContext, codec: ExportVideoCodec): AsyncResult<void> {
  if (codec === 'h264') return ok(undefined);
  const found = await hardwareEncoders(media, { codecs: [codec] });
  if (!found.ok) return found;
  const availability = codecAvailability(codec, found.value);
  if (availability.available) return ok(undefined);
  return err(
    CodecUnavailable(
      { codec },
      { detail: `no working hardware ${codec} encoder on this machine (${availability.reasonKey})` },
    ),
  );
}
