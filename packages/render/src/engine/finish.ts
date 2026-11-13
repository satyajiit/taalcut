// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The finishing stage (SPEC section 4): the producer's silent picture and
 * the mixed sound become the deliverable MP4. The producer's hardware H.264 is
 * stream-copied and only gets its colour tagged (BT.709, limited range: the
 * producer leaves primaries and transfer unset, and platforms then guess);
 * HEVC re-encodes with the `hvc1` tag Apple players need; a ProRes mezzanine
 * from the CPU route, or a QA re-encode, is encoded once more. GPU first: the
 * encoder is media's working one for the codec (h264_videotoolbox,
 * h264_nvenc; a trial encode proves it) with media's export flags; the platform's software H.264 encoder
 * when the machine has no hardware encoder or hardware is off (reported with
 * media's reason), or when the hardware one fails (it won't start, or fails on
 * the picture), through the shared software retry (hardware-route.ts, IX3-K4).
 * HEVC has no software encoder in the LGPL build, so a refused HEVC encode fails.
 * AV1 (LNX1-AV1) re-encodes on the machine's hardware AV1 encoder (av1_nvenc), and only
 * when that encode fails at run time once more on SVT-AV1, reported as `render.encode`
 * `accelerator_failed`; a machine with no working hardware AV1 encoder is refused
 * (`render.codec_unavailable`) rather than sent to the CPU up front.
 */
import { rm } from 'node:fs/promises';
import {
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type ExportPreset,
  type FrameRate,
} from '@taalcut/core';
import {
  backendOfEncoder,
  colourBitstreamFilter,
  runFfmpeg,
  softwareEncoderFor,
  videoEncodeFlags,
  type MediaContext,
} from '@taalcut/media';
import { muxAudio } from '../audio/mix';
import { CodecUnavailable, EncodeFailed } from '../errors';
import { videoBitrateKbps } from '../presets/presets.v1';
import { onHardwareRoute } from './hardware-route';
import { encoderFor, hardwareLabel, wantedBy, type VideoRoute } from './video-route';
import { h264LevelFlags } from '../presets/h264-level';

/** BT.709 primaries, transfer and matrix, limited range, written into the bitstream's VUI (AV1: its sequence header). */
export const COLOUR_BSF = {
  h264: 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
  hevc: 'hevc_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
  av1: colourBitstreamFilter('av1'),
} as const;

/** The same, as the stream's (and so the MP4 `colr` box's) colour properties. */
const COLOUR_ARGS = [
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-colorspace',
  'bt709',
  '-color_range',
  'tv',
];

/**
 * A re-encode's picture: BT.709 limited-range YUV 4:2:0, with the frames themselves tagged. FFmpeg (9.0) takes an
 * encoder's primaries and transfer from its frames, so COLOUR_ARGS alone leave them unset when the frames carry none,
 * as the CPU route's ProRes mezzanine does: under load the producer's own VideoToolbox probe (2 s) times out, the
 * render takes that route, and QA's codec check found the deliverable untagged (IX-F2). `setparams` tags the frames
 * for every encoder here: the hardware ones, OpenH264 and HEVC.
 */
const PICTURE_FILTER =
  'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,' +
  'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';
const LONG_RUN_MS = 30 * 60_000;

export interface FinishInput {
  /** The producer's silent picture: H.264 .mp4, or a ProRes .mov from the CPU route. */
  readonly video: string;
  /** The mixed AAC. */
  readonly audio: string;
  readonly out: string;
  readonly preset: ExportPreset;
  readonly rate: FrameRate;
  readonly ctx: MediaContext;
  /** Encode the picture again even when it is already H.264 (QA's `reencode` fix). */
  readonly reencode?: boolean;
  readonly signal?: AbortSignal;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
}

export interface FinishResult {
  readonly path: string;
  /** How the picture got into the file: 'copied', or the encoder that wrote it ('h264_nvenc', 'libopenh264'). */
  readonly video: 'copied' | (string & {});
}

/** The encode alone on a software decode: what a retry's report names. */
const encodeOnly = (encoder: string): VideoRoute => ({ decode: { backend: 'software' }, encoder });

function encodePicture(input: FinishInput, encoder: string, out: string) {
  const gop = Math.round(input.rate.num / input.rate.den);
  return runFfmpeg(
    input.ctx,
    [
      '-y',
      '-i',
      input.video,
      '-map',
      '0:v:0',
      '-vf',
      PICTURE_FILTER,
      // The encoder's row's export flags (media): rate, GOP, BT.709 tags and VUI, `hvc1` on HEVC, H.264 High.
      ...videoEncodeFlags(encoder, videoBitrateKbps(input.preset, input.rate) * 1000, gop, {
        purpose: 'export',
      }),
      ...h264LevelFlags(encoder, input.preset.width, input.preset.height, input.rate),
      '-an',
      '-fflags',
      '+bitexact',
      out,
    ],
    {
      // A hardware encode is never killed on a stop (IX3-K2).
      holdsVideoSession: backendOfEncoder(encoder) !== undefined,
      timeoutMs: LONG_RUN_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
}

const cancelled = (code: string) => code === 'media.cancelled' || code === 'core.cancelled';

/**
 * The picture re-encoded to `encoded` on media's working encoder; once more on the codec's CPU encoder (OpenH264,
 * SVT-AV1) when the hardware one fails (refused, or a format it can't take). AV1 never starts on the CPU. A cancel
 * is returned as it is; any other failure is `render.encode_failed`. Returns the encoder that wrote it.
 */
async function reencodePicture(input: FinishInput, encoded: string): AsyncResult<string> {
  const codec = input.preset.video.codec;
  const planned = await encoderFor(input.ctx, codec, input.preset, 'render.encode', input.signal);
  if (!planned.ok)
    return cancelled(planned.error.code)
      ? planned
      : err(EncodeFailed(undefined, { detail: planned.error.detail ?? planned.error.code }));
  const first = planned.value.choice.encoder;
  const hardware = backendOfEncoder(first) !== undefined;
  if (codec === 'av1' && !hardware)
    return err(CodecUnavailable({ codec }, { detail: planned.value.choice.fallbackReason?.detail ?? first }));
  if (planned.value.fallback) input.onFallback?.(planned.value.fallback);
  let how = first;
  const result = await onHardwareRoute<string, unknown>(
    {
      first,
      software: hardware ? softwareEncoderFor(codec, input.ctx.platform) : undefined,
      operation: 'render.encode',
      wanted: wantedBy(encodeOnly(first)),
      label: hardwareLabel(encodeOnly(first)),
      anyFfmpegFailure: true,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onFallback ? { onFallback: input.onFallback } : {}),
    },
    (encoder) => {
      how = encoder;
      return encodePicture(input, encoder, encoded);
    },
  );
  if (result.ok) return ok(how);
  if (cancelled(result.error.code)) return result;
  return err(EncodeFailed(undefined, { detail: result.error.detail ?? result.error.code }));
}

export async function finishRender(input: FinishInput): AsyncResult<FinishResult> {
  const codec = input.preset.video.codec;
  const mezzanine = input.video.endsWith('.mov');
  let picture = input.video;
  let how: FinishResult['video'] = 'copied';
  // The producer writes H.264: HEVC and AV1 are encoded here.
  if (codec !== 'h264' || mezzanine || input.reencode) {
    const encoded = `${input.out}.video.mp4`;
    const reencoded = await reencodePicture(input, encoded);
    if (!reencoded.ok) return reencoded;
    how = reencoded.value;
    picture = encoded;
  }
  // The copied picture's colour, in its bitstream (the filter) and in the container (the args), whatever the source
  // left unset: a stream copy can't retag frames.
  const muxed = await muxAudio(picture, input.audio, input.out, input.ctx, {
    videoBitstreamFilter: COLOUR_BSF[codec],
    videoColour: COLOUR_ARGS,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (picture !== input.video) await rm(picture, { force: true });
  if (!muxed.ok) return muxed;
  return ok({ path: muxed.value.path, video: how });
}
