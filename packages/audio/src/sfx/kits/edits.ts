// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A kit's knobs on a pre-rendered take, as signal processing (EAR1-D3; no Python at run time). earshot turns its
 * knobs inside the recipe; the bank ships renders, so here: `pitch` resamples (a windowed-sinc read at the pitch
 * ratio, low-passed when reading faster) and time-stretches back to the length (Signalsmith, the stretcher audio
 * already uses); `dur` fades out to the length, or pads, for a sound earshot trims, and stretches a sound earshot
 * reshapes (the whoosh family, the length-keyed recipes) before fitting it exactly; `apex` moves a whoosh's loudest
 * 5 ms onto the target by trimming its quiet approach or padding silence before it; `peak_db` and `weight` set the
 * sample peak (6 dB per doubling of weight); `max_s` fades a longer take out. The fades are earshot's
 * (`knobs.fit_length`: raised cosine over a quarter of the length, 10-150 ms).
 */
import { ok, type AsyncResult } from '@taalcut/core';
import type { TimeStretcher } from '../../stretch/stretcher';
import { apexSeconds } from '../bank-apex';

export const SR = 48_000;
const FADE_MIN_S = 0.002;
/** The quiet approach a moved apex may lose: at least this far under the take's peak. */
const HEAD_DB = -20;
const HEAD_FADE_S = 0.003;

export type Channels = readonly Float32Array[];

/** The channels' mean, as earshot's `_mono`. */
export function meanOf(channels: Channels): Float64Array {
  const [a, b] = channels;
  const out = new Float64Array(a?.length ?? 0);
  for (let i = 0; i < out.length; i++)
    out[i] = b && b !== a ? ((a?.[i] ?? 0) + (b[i] ?? 0)) / 2 : (a?.[i] ?? 0);
  return out;
}

export function samplePeak(channels: Channels): number {
  let peak = 0;
  for (const c of channels) for (const v of c) peak = Math.max(peak, Math.abs(v));
  return peak;
}

/** `bank.normalize`: the sample peak to `peakDb` dBFS. */
export function toPeak(channels: Channels, peakDb: number): Float32Array[] {
  const gain = 10 ** (peakDb / 20) / (samplePeak(channels) + 1e-12);
  return channels.map((c) => c.map((v) => v * gain));
}

/** `knobs.fit_length`: exactly `durS` long; a cut fades out (not before `keepS`), a short take is padded. */
export function fitLength(channels: Channels, durS: number, keepS?: number): Float32Array[] {
  const n = Math.round(durS * SR);
  const length = channels[0]?.length ?? 0;
  if (length === n) return channels.map((c) => c.slice());
  if (length < n)
    return channels.map((c) => {
      const out = new Float32Array(n);
      out.set(c);
      return out;
    });
  let k = Math.min(n, Math.max(Math.trunc(0.01 * SR), Math.min(Math.trunc(0.15 * SR), Math.trunc(0.25 * n))));
  if (keepS !== undefined)
    k = Math.min(n, Math.max(Math.trunc(FADE_MIN_S * SR), Math.min(k, n - Math.round(keepS * SR))));
  return channels.map((c) => {
    const out = c.slice(0, n);
    for (let i = 0; i < k; i++) {
      const w = 0.5 + 0.5 * Math.cos((Math.PI * i) / Math.max(1, k - 1));
      out[n - k + i] = (out[n - k + i] ?? 0) * w;
    }
    return out;
  });
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const LOBES = 12;

/** `channels` read at `ratio` input samples per output sample (a windowed sinc, low-passed when ratio > 1). */
export function resample(channels: Channels, ratio: number): Float32Array[] {
  const scale = Math.min(1, 1 / ratio);
  const half = Math.ceil(LOBES / scale);
  return channels.map((x) => {
    const n = Math.max(1, Math.floor(x.length / ratio));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i * ratio;
      const centre = Math.floor(t);
      let acc = 0;
      for (let j = Math.max(0, centre - half + 1); j <= Math.min(x.length - 1, centre + half); j++) {
        const d = (t - j) * scale;
        if (Math.abs(d) >= LOBES) continue;
        const window =
          0.42 + 0.5 * Math.cos((Math.PI * d) / LOBES) + 0.08 * Math.cos((2 * Math.PI * d) / LOBES);
        acc += (x[j] ?? 0) * scale * sinc(d) * window;
      }
      out[i] = acc;
    }
    return out;
  });
}

/** Time-stretched (pitch kept) to `length` samples. */
async function stretchTo(
  stretcher: TimeStretcher,
  channels: Channels,
  length: number,
): AsyncResult<Float32Array[]> {
  const n = channels[0]?.length ?? 0;
  if (n === length) return ok(channels.map((c) => c.slice()));
  const made = await stretcher.stretch({ sampleRate: SR, channels: [...channels] }, [
    { sourceStart: 0, sourceEnd: n, targetLength: length },
  ]);
  if (!made.ok) return made;
  return ok(made.value.channels.map((c) => (c.length === length ? c : fitTo(c, length))));
}

const fitTo = (c: Float32Array, length: number) => {
  const out = new Float32Array(length);
  out.set(c.subarray(0, length));
  return out;
};

/** Shifted by `semitones`, the length kept (resampled, then stretched back). */
export async function shiftPitch(
  stretcher: TimeStretcher,
  channels: Channels,
  semitones: number,
): AsyncResult<Float32Array[]> {
  if (Math.abs(semitones) < 1e-6) return ok(channels.map((c) => c.slice()));
  const read = resample(channels, 2 ** (semitones / 12));
  return stretchTo(stretcher, read, channels[0]?.length ?? 0);
}

/** The loudest 5 ms moved to `apexS`: the quiet approach trimmed (with a 3 ms fade-in), or silence padded before. */
export function aimApex(channels: Channels, apexS: number): Float32Array[] {
  const mono = meanOf(channels);
  const shift = Math.round(apexS * SR) - Math.round(apexSeconds(mono) * SR);
  if (shift >= 0)
    return channels.map((c) => {
      const out = new Float32Array(c.length + shift);
      out.set(c, shift);
      return out;
    });
  // Trim no further than the approach stays 20 dB under the peak.
  const floor = samplePeak(channels) * 10 ** (HEAD_DB / 20);
  let limit = 0;
  while (limit < mono.length && Math.abs(mono[limit] ?? 0) < floor) limit++;
  const cut = Math.min(-shift, limit);
  const fade = Math.round(HEAD_FADE_S * SR);
  return channels.map((c) => {
    const out = c.slice(cut);
    for (let i = 0; i < Math.min(fade, out.length); i++) out[i] = (out[i] ?? 0) * (i / fade);
    return out;
  });
}

/** A short fade at each end, so a stretched or resampled take starts and ends on zero (the audit's `edge`). */
export function fadeEnds(channels: Channels, inS = 0.001, outS = 0.005): Float32Array[] {
  return channels.map((c) => {
    const out = c.slice();
    const a = Math.min(out.length, Math.round(inS * SR));
    const b = Math.min(out.length, Math.round(outS * SR));
    for (let i = 0; i < a; i++) out[i] = (out[i] ?? 0) * (i / a);
    for (let i = 0; i < b; i++) out[out.length - 1 - i] = (out[out.length - 1 - i] ?? 0) * (i / b);
    return out;
  });
}

export interface TakeEdits {
  readonly dur?: number;
  readonly apex?: number;
  /** Semitones from the take's native pitch. */
  readonly semitones?: number;
  readonly peakDb?: number;
  readonly weight?: number;
  readonly maxS?: number | null;
  /** How earshot changes the sound's length: `trim` fades or pads, `shape` / `param` reshape (stretched here). */
  readonly durMethod: 'shape' | 'param' | 'trim';
}

/** Every knob on one take, in earshot's order (pitch, length, apex, then max_s and the level). */
export async function applyEdits(
  stretcher: TimeStretcher,
  take: Channels,
  edits: TakeEdits,
): AsyncResult<Float32Array[]> {
  let x: Float32Array[] = take.map((c) => c.slice());
  let touched = false;
  if (edits.semitones !== undefined && Math.abs(edits.semitones) > 1e-6) {
    const shifted = await shiftPitch(stretcher, x, edits.semitones);
    if (!shifted.ok) return shifted;
    x = shifted.value;
    touched = true;
  }
  if (edits.dur !== undefined) {
    const length = Math.round(edits.dur * SR);
    if (edits.durMethod !== 'trim' && length !== (x[0]?.length ?? 0)) {
      const stretched = await stretchTo(stretcher, x, length);
      if (!stretched.ok) return stretched;
      x = stretched.value;
      touched = true;
    }
    x = fitLength(x, edits.dur, edits.apex);
  }
  if (edits.apex !== undefined)
    x = fitLength(aimApex(x, edits.apex), edits.dur ?? (x[0]?.length ?? 0) / SR, edits.apex);
  if (edits.maxS && (x[0]?.length ?? 0) > edits.maxS * SR) x = fitLength(x, edits.maxS);
  if (touched) x = fadeEnds(x);
  const level = (edits.peakDb ?? -1) + (edits.weight !== undefined ? 20 * Math.log10(edits.weight) : 0);
  return ok(toPeak(x, level));
}
