// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One decode for every part of an analysis (EAR1-F7), as earshot's `audio.load` makes both of its conventions: the
 * stereo decode the DSP reads (48 kHz, two channels, a mono source duplicated at unity gain) and the models' mono
 * (ffmpeg `-ac 1`'s level: a stereo source (L + R) / √2, a mono one as it is). Upstream decodes the file whole and
 * slices `[round(start·SR), round(end·SR))`.
 *
 * EAR1-R1: for a range only the range's PCM is written out (one second of an 11-minute file wrote 11 minutes, past
 * the decode's 10-minute limit). FFmpeg runs the whole file's pipeline (the same decoder and resampler state: input
 * seeking lands AAC up to a frame off) and writes out the whole seconds around the range (output `-ss`/`-t`); the
 * same `[round(start·SR), round(end·SR))` is cut from that, so the samples are the whole file's exactly. A range past
 * the end holds no audio: `listen_bad_input`. An abort is core.cancelled, never a failure to retry; a file too long
 * to decode whole is `listen_bad_input` (ask for a range), not a retry either.
 */
import {
  CancelledError,
  err,
  ok,
  RationalTime,
  TimeRange,
  type AsyncResult,
  type TaalcutError,
} from '@taalcut/core';
import { MediaCancelled, OutputTooLarge, probeMedia, runFfmpeg, type MediaContext } from '@taalcut/media';
import { fromInterleaved } from '../../pcm/pcm';
import { LISTEN_CONFIG } from '../config';
import type { ListenSource } from '../describe/context';
import type { ListenAudio } from '../dsp/pcm';
import { ListenBadInput, ListenFailed } from '../errors';

const SR = LISTEN_CONFIG.sampleRate;

export interface DecodedListen {
  /** The DSP's input: 48 kHz, one channel (a mono source) or two. */
  readonly audio: ListenAudio;
  /** The models' input: 48 kHz mono at ffmpeg `-ac 1`'s level, with the source's channel count. */
  readonly source: ListenSource;
}

function peak(channels: readonly Float32Array[]): number {
  let top = 0;
  for (const channel of channels) for (const v of channel) top = Math.max(top, Math.abs(v));
  return 20 * Math.log10(Math.max(top, 1e-12));
}

/** Both conventions from decoded 48 kHz audio: one channel, or two (left, right). */
export function listenSourceOf(audio: ListenAudio): DecodedListen {
  const [left, right] = audio.channels;
  const first = left ?? new Float32Array(0);
  if (!right || right === left) {
    return {
      audio: { sampleRate: SR, channels: [first] },
      source: { samples: first, channels: 1, peakDbfs: peak([first]) },
    };
  }
  const mono = new Float32Array(first.length);
  for (let i = 0; i < mono.length; i++) mono[i] = ((first[i] ?? 0) + (right[i] ?? 0)) * Math.SQRT1_2;
  return {
    audio: { sampleRate: SR, channels: [first, right] },
    source: { samples: mono, channels: 2, peakDbfs: peak([first, right]) },
  };
}

/** Samples [first, end) of each channel, clipped to the audio. */
function sliceSamples(audio: ListenAudio, first: number, end: number): ListenAudio {
  const length = audio.channels[0]?.length ?? 0;
  const a = Math.min(length, Math.max(0, first));
  const b = Math.max(a, Math.min(length, end));
  return { sampleRate: audio.sampleRate, channels: audio.channels.map((channel) => channel.subarray(a, b)) };
}

/** `audio.load(path, start=, end=)`: samples [round(start·SR), round(end·SR)) of each channel. */
export function sliceListenAudio(audio: ListenAudio, range: TimeRange): ListenAudio {
  const start = RationalTime.toSeconds(range.start);
  const end = RationalTime.toSeconds(TimeRange.end(range));
  return sliceSamples(audio, Math.round(start * SR), Math.round(end * SR));
}

export interface DecodeListenSourceOptions {
  readonly media: MediaContext;
  readonly range?: TimeRange;
  readonly signal?: AbortSignal;
}

/** Ten minutes of 48 kHz stereo float: what one decode may hold. */
const MAX_PCM_BYTES = 10 * 60 * SR * 2 * 4;
/** Whole seconds written out after a range, then dropped (the end is never short by FFmpeg's rounding). */
const TAIL_S = 1;

/** core.cancelled for an abort (media's own or the signal's); the decode's other failures as listen errors. */
export function listenDecodeError(error: TaalcutError, path: string, signal?: AbortSignal): TaalcutError {
  if (signal?.aborted || error.code === 'core.cancelled' || error.code === MediaCancelled.code)
    return CancelledError();
  const detail = `${path}: ${error.detail ?? error.code}`.slice(0, 500);
  if (error.code === OutputTooLarge.code)
    return ListenBadInput(undefined, { detail: `${path}: over 10 minutes of audio; ask for a range` });
  return ListenFailed(undefined, { detail });
}

/** `[from, from + span)` seconds of the file (all of it without), 48 kHz float, `channels` as FFmpeg mixes them. */
async function decodeSpan(
  path: string,
  media: MediaContext,
  channels: 1 | 2,
  span: { readonly from: number; readonly length: number } | undefined,
  signal?: AbortSignal,
): AsyncResult<readonly Float32Array[]> {
  // Output options: the whole file's pipeline (the same decoder and resampler state), only the span written out.
  const seek = span ? ['-ss', String(span.from), '-t', String(span.length)] : [];
  const args = ['-i', path, '-vn', '-ac', String(channels), '-ar', String(SR), ...seek];
  const run = await runFfmpeg(media, [...args, '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'], {
    // Audio only: a stop keeps SIGTERM then SIGKILL (IX3-K2).
    holdsVideoSession: false,
    maxStdoutBytes: MAX_PCM_BYTES,
    timeoutMs: 180_000,
    ...(signal ? { signal } : {}),
  });
  if (!run.ok) return err(listenDecodeError(run.error, path, signal));
  return ok(fromInterleaved(run.value.stdout, channels, SR).channels);
}

/** Any file media can read, decoded once (earshot `audio._decode`: `-ac 1` for a mono source, else `-ac 2`). */
export async function decodeListenSource(
  path: string,
  options: DecodeListenSourceOptions,
): AsyncResult<DecodedListen> {
  const { signal, range } = options;
  if (signal?.aborted) return err(CancelledError());
  const probed = await probeMedia(path, options.media, signal ? { signal } : {});
  if (!probed.ok) {
    const error = listenDecodeError(probed.error, path, signal);
    if (error.code === 'core.cancelled') return err(error);
    return err(
      ListenBadInput(undefined, { detail: (probed.error.detail ?? probed.error.code).slice(0, 500) }),
    );
  }
  if (!probed.value.audio) return err(ListenBadInput(undefined, { detail: `${path} has no audio stream` }));
  const channels = (probed.value.audio.channels ?? 2) === 1 ? 1 : 2;
  const startS = range ? RationalTime.toSeconds(range.start) : 0;
  const endS = range ? RationalTime.toSeconds(TimeRange.end(range)) : 0;
  // Whole seconds: any rate puts a whole second on a whole sample, so the cut below is on the whole file's grid.
  const from = range ? Math.max(0, Math.floor(startS)) : 0;
  const span = range ? { from, length: Math.ceil(endS) + TAIL_S - from } : undefined;
  const decoded = await decodeSpan(path, options.media, channels, span, signal);
  if (!decoded.ok) return decoded;
  const audio: ListenAudio = { sampleRate: SR, channels: decoded.value };
  const sliced = range
    ? sliceSamples(audio, Math.round(startS * SR) - from * SR, Math.round(endS * SR) - from * SR)
    : audio;
  if ((sliced.channels[0]?.length ?? 0) === 0) {
    const why = range ? 'the range holds no audio: it starts past the end' : 'no audio samples';
    return err(ListenBadInput(undefined, { detail: `${path}: ${why}` }));
  }
  return ok(listenSourceOf(sliced));
}
