// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real FFmpeg on a machine whose hardware video refuses sessions (IX3-K4), as media's own refusal test plays it:
 * a run with a hardware decode fails with libavcodec's setup line (and the graph error that follows), a run with
 * a VideoToolbox encoder with videotoolboxenc.c's compression-session line, an NVENC encoder with nvenc.c's
 * OpenEncodeSessionEx line (LNX1-RND); every other run is the real FFmpeg, in software. Nothing reaches the
 * hardware. A real refusal can't be triggered on demand (it came under load).
 *
 * `-allow_sw 1` is honoured as VideoToolbox does (IX3-F5, M5): the refused hardware session quietly becomes Apple's
 * software encoder and the run succeeds with no refusal line (played here by OpenH264), so a route that still asks
 * for it never reaches its logged retry.
 */
import { ok } from '@taalcut/core';
import { runProcess, type ProcessRunner } from '@taalcut/media';

export const DECODER_REFUSED =
  '[h264 @ 0x1] Failed setup for format videotoolbox_vld: hwaccel initialisation returned error.\n' +
  "Impossible to convert between the formats supported by the filter 'Parsed_split_3' and the filter 'auto_scale_0'";
export const ENCODER_REFUSED =
  '[h264_videotoolbox @ 0x1] Cannot create compression session: -12902\n' +
  '[h264_videotoolbox @ 0x1] Try -allow_sw 1. The hardware encoder may be busy, or not supported.\n' +
  'Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.';

/** An NVENC session refused (libavcodec/nvenc.c, at AV_LOG_ERROR), as media's patterns read it. */
export const NVENC_REFUSED =
  '[h264_nvenc @ 0x1] OpenEncodeSessionEx failed: incompatible client key (21): (no details)\n' +
  '[h264_nvenc @ 0x1] No capable devices found\n' +
  'Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.';

/** The decode refusal a hardware run of `args` gets: the format its `-hwaccel_output_format` (or row) names. */
const decoderRefused = (args: readonly string[]) => {
  const at = args.indexOf('-hwaccel');
  const format = args[at + 1] === 'videotoolbox' ? 'videotoolbox_vld' : (args[at + 1] ?? 'unknown');
  return at < 0 || format === 'videotoolbox_vld'
    ? DECODER_REFUSED
    : DECODER_REFUSED.replace('videotoolbox_vld', format);
};

export interface Refusing {
  readonly runner: ProcessRunner;
  /** Every FFmpeg run's arguments, in order. */
  readonly calls: (readonly string[])[];
}

/** Refuses hardware decodes (`decode`) and VideoToolbox and NVENC encoders (`encode`), each by default. */
export function refusingHardware(refuse: { decode?: boolean; encode?: boolean } = {}): Refusing {
  const { decode = true, encode = true } = refuse;
  const calls: (readonly string[])[] = [];
  const refused = (stderrTail: string) =>
    Promise.resolve(ok({ exitCode: 1, signal: null, stdout: Buffer.alloc(0), stderrTail, durationMs: 1 }));
  const runner: ProcessRunner = (command, args, options) => {
    calls.push(args);
    if (decode && args.includes('-hwaccel')) return refused(decoderRefused(args));
    if (encode && args.some((arg) => arg.endsWith('_nvenc'))) return refused(NVENC_REFUSED);
    if (encode && args.some((arg) => arg.endsWith('_videotoolbox'))) {
      const cpu = args.indexOf('-require_sw');
      if (cpu >= 0 && args[cpu + 1] === '1') return runProcess(command, args, options);
      const at = args.indexOf('-allow_sw');
      if (at < 0 || args[at + 1] !== '1') return refused(ENCODER_REFUSED);
      const quietly = args.map((arg, index) => (index === at ? '-require_sw' : arg));
      return runProcess(command, quietly, options);
    }
    return runProcess(command, args, options);
  };
  return { runner, calls };
}

/** The same stand-in under its first name (the Mac's VideoToolbox). */
export const refusingVideoToolbox = refusingHardware;
