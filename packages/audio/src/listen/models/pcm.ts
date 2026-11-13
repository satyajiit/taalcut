// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A source as the listening models hear it: 48 kHz mono at earshot's level. Upstream decodes with ffmpeg's `-ac 1`
 * (`audio.load(mono=True)`, the convention its calibration was measured with): a stereo source becomes
 * (L + R) / √2 and a mono one stays as it is. Media's `extractAudio` makes every source stereo first, then averages:
 * (L + R) / 2 for stereo, and a mono source 3 dB down. Both differ from upstream by exactly √2 (measured on the
 * parity clips: 9e-8 apart after the scale), so the samples are scaled back up here.
 *
 * `timelineMono` is the other convention upstream uses: timeline.py loads stereo and averages (`audio.to_mono`),
 * a mono source duplicated at unity gain. Sections (timeline/sections.ts) read that one.
 */
import { CancelledError, err, ok, type AsyncResult, type TaalcutError, type TimeRange } from '@taalcut/core';
import {
  extractAudio,
  MediaCancelled,
  planNormalisation,
  probeMedia,
  type MediaContext,
} from '@taalcut/media';
import { msTime, rangeToMs } from '../../rates';
import { LISTEN_CONFIG } from '../config';
import { ListenBadInput, ListenFailed } from '../errors';

export interface ListenPcm {
  /** 48 kHz mono at ffmpeg `-ac 1`'s level. */
  readonly samples: Float32Array;
  /** The source's channel count (1 for mono). */
  readonly channels: number;
}

export interface DecodeListenOptions {
  readonly media: MediaContext;
  readonly range?: TimeRange;
  readonly signal?: AbortSignal;
}

function f32le(chunks: readonly Buffer[]): Float32Array {
  const bytes = Buffer.concat(chunks);
  const length = bytes.length - (bytes.length % 4);
  const copy = new ArrayBuffer(length);
  new Uint8Array(copy).set(bytes.subarray(0, length));
  return new Float32Array(copy);
}

/** An abort, media's own or the signal's (EAR1-R1): core.cancelled, never a failure to retry. */
const cancelled = (error: TaalcutError, signal?: AbortSignal): boolean =>
  signal?.aborted === true || error.code === 'core.cancelled' || error.code === MediaCancelled.code;

export async function decodeListenAudio(path: string, options: DecodeListenOptions): AsyncResult<ListenPcm> {
  if (options.signal?.aborted) return err(CancelledError());
  const probed = await probeMedia(path, options.media, options.signal ? { signal: options.signal } : {});
  if (!probed.ok) {
    if (cancelled(probed.error, options.signal)) return err(CancelledError());
    return err(
      ListenBadInput(undefined, { detail: (probed.error.detail ?? probed.error.code).slice(0, 500) }),
    );
  }
  if (!probed.value.audio) return err(ListenBadInput(undefined, { detail: `${path} has no audio stream` }));
  const plan = planNormalisation(probed.value);
  if (!plan.ok)
    return err(ListenBadInput(undefined, { detail: (plan.error.detail ?? plan.error.code).slice(0, 500) }));
  const span = options.range ? rangeToMs(options.range) : undefined;
  const chunks: Buffer[] = [];
  const extracted = await extractAudio(path, plan.value, options.media, {
    sampleRate: LISTEN_CONFIG.sampleRate,
    format: 'f32le',
    onChunk: (chunk) => chunks.push(chunk),
    ...(span
      ? { range: { start: msTime(span.startMs), duration: msTime(Math.max(0, span.endMs - span.startMs)) } }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!extracted.ok) {
    if (cancelled(extracted.error, options.signal)) return err(CancelledError());
    return err(
      ListenFailed(undefined, { detail: (extracted.error.detail ?? extracted.error.code).slice(0, 500) }),
    );
  }
  const samples = f32le(chunks);
  for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] ?? 0) * Math.SQRT2;
  return ok({ samples, channels: probed.value.audio.channels ?? 1 });
}

/** timeline.py's mono: the mean of the channels, a mono source at unity gain. */
export function timelineMono(pcm: ListenPcm): Float32Array {
  if (pcm.channels <= 1) return pcm.samples;
  const out = new Float32Array(pcm.samples.length);
  for (let i = 0; i < out.length; i++) out[i] = (pcm.samples[i] ?? 0) / Math.SQRT2;
  return out;
}
