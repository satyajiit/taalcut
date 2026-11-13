// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * earshot's `audio.resample` (soxr, quality 'HQ') from 48 kHz to the two rates lane A needs: 32 kHz (realness's
 * signal measurements) and 22.05 kHz (the critique's librosa onsets). soxr's one-shot resampler is linear phase,
 * and measured on impulses its response is one windowed sinc: cut-off 0.95686 of the output Nyquist rate under a
 * Kaiser window (32 kHz: β 13.04 over ±96.83 output samples, within 5e-8 of soxr's taps; 22.05 kHz: β 15.95 over
 * ±110.06, within 4e-5). This evaluates that kernel per output phase (2 phases for 2/3, 147 for 147/320), zeros
 * past both ends, `round(n · to / from)` samples out as soxr gives. models/resample.ts is F4's 16 kHz decimator.
 */
import { checkpoint } from '../abort';
import { pyRound } from '../dsp/pcm';

interface Design {
  /** Output samples per input sample, as up / down in lowest terms. */
  readonly up: number;
  readonly down: number;
  readonly cutoff: number;
  readonly beta: number;
  /** Half-length of the Kaiser window, in output samples. */
  readonly half: number;
}

const DESIGNS: Readonly<Record<number, Design>> = {
  32_000: { up: 2, down: 3, cutoff: 0.95687183, beta: 13.04009767, half: 96.83355815 },
  22_050: { up: 147, down: 320, cutoff: 0.95684062, beta: 15.95411846, half: 110.05579667 },
};

export const RESAMPLE_RATES = [32_000, 22_050] as const;
export type ResampleRate = (typeof RESAMPLE_RATES)[number];

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 80; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/** The kernel at `t` output samples from an input sample. */
function kernelAt(d: Design, t: number): number {
  if (Math.abs(t) >= d.half) return 0;
  const ratio = d.up / d.down;
  const x = d.cutoff * t;
  const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
  const r = t / d.half;
  const window = besselI0(d.beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(d.beta);
  return ratio * d.cutoff * sinc * window;
}

interface Plan {
  readonly d: Design;
  readonly out: Float32Array;
  readonly table: Float64Array;
  readonly reach: number;
  readonly width: number;
}

function planFor(input: Float32Array, rate: ResampleRate): Plan {
  const d = DESIGNS[rate];
  if (!d) throw new Error(`no resampler to ${rate} Hz`);
  const out = new Float32Array(pyRound((input.length * d.up) / d.down));
  const ratio = d.up / d.down;
  // Output m sits at input position m·down/up = base + phase/up; taps k run over input base + k.
  const reach = Math.ceil(d.half / ratio) + 1;
  const width = 2 * reach + 1;
  const table = new Float64Array(input.length === 0 ? 0 : d.up * width);
  if (input.length > 0) {
    for (let p = 0; p < d.up; p++) {
      for (let k = -reach; k <= reach; k++)
        table[p * width + k + reach] = kernelAt(d, ratio * (p / d.up - k));
    }
  }
  return { d, out, table, reach, width };
}

/** Output samples [from, to): each one is its own sum, so any split gives the same samples. */
function fill(plan: Plan, input: Float32Array, from: number, to: number): void {
  const { d, out, table, reach, width } = plan;
  const last = input.length - 1;
  for (let m = from; m < to; m++) {
    const pos = m * d.down;
    const base = Math.floor(pos / d.up);
    const row = (pos - base * d.up) * width + reach - base;
    let acc = 0;
    const lo = Math.max(-reach, -base) + base;
    const hi = Math.min(reach, last - base) + base;
    // Indices stay in range by construction: the casts keep the hot loop free of undefined checks. Four taps a
    // step: the CPU's critique path pays for this loop on every render (about 40% faster than one a step).
    let i = lo;
    for (; i + 3 <= hi; i += 4) {
      acc +=
        (table[row + i] as number) * (input[i] as number) +
        (table[row + i + 1] as number) * (input[i + 1] as number) +
        (table[row + i + 2] as number) * (input[i + 2] as number) +
        (table[row + i + 3] as number) * (input[i + 3] as number);
    }
    for (; i <= hi; i++) acc += (table[row + i] as number) * (input[i] as number);
    out[m] = acc;
  }
}

/** 48 kHz mono → `rate`, in float32 as soxr returns it for float32 input. */
export function resampleFrom48k(input: Float32Array, rate: ResampleRate): Float32Array {
  const plan = planFor(input, rate);
  if (input.length > 0) fill(plan, input, 0, plan.out.length);
  return plan.out;
}

/** Output samples per slice between checkpoints (about 50 ms of CPU). */
const SLICE = 1 << 17;

/** `resampleFrom48k` in slices, stopping at an abort (abort.ts `checkpoint`): the same samples. */
export async function resampleFrom48kAbortable(
  input: Float32Array,
  rate: ResampleRate,
  signal?: AbortSignal,
): Promise<Float32Array> {
  if (!signal) return resampleFrom48k(input, rate);
  const plan = planFor(input, rate);
  if (input.length === 0) return plan.out;
  for (let from = 0; from < plan.out.length; from += SLICE) {
    await checkpoint(signal);
    fill(plan, input, from, Math.min(plan.out.length, from + SLICE));
  }
  return plan.out;
}
