// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Constant-Q chroma for the key (earshot features.key_estimate reads librosa's `chroma_cqt`: 7 octaves from C1, 36
 * bins per octave, hop 512 at 22.05 kHz, Hann wavelets L1-normalised and scaled by √length, three bins merged per
 * semitone, each frame divided by its largest class). librosa itself is not ported: this builds the same wavelets
 * octave by octave on a 16 kHz copy halved per octave (resample_poly-style FIR), hop 384 at 16 kHz (24 ms). Every
 * octave's 36 wavelets are the same at its own rate, so all octaves' frames go through one filter-bank graph.
 * Not ported: librosa's tuning estimate (A440 assumed) and its 1 % basis sparsification.
 */
import { hannPeriodic } from './fft';
import { LISTEN_SR } from './pcm';
import type { SpectrogramRunner } from './spectrogram-graph';
import { centredPad, frameSignal, type SpectrogramSpec } from './transforms';

const BPO = 36;
const OCTAVES = 7;
const C1 = 32.70319566257483;
const SR_TOP = 16_000;
const HOP_TOP = 384;
const FRAME = 512;
/** librosa's equal-temperament relative bandwidth: Q = 1 / ((r² − 1) / (r² + 1)), r = 2^(1/36). */
const Q = (() => {
  const r2 = 2 ** (2 / BPO);
  return (r2 + 1) / (r2 - 1);
})();

/** Frequencies of the top octave (bins 216..251 above C1), the octave every lower one repeats at half the rate. */
function topFreqs(): Float64Array {
  const f = new Float64Array(BPO);
  for (let j = 0; j < BPO; j++) f[j] = C1 * 2 ** ((BPO * (OCTAVES - 1) + j) / BPO);
  return f;
}

/** The top octave's wavelets (librosa filters.wavelet) at 16 kHz, centred in 512-sample frames, and the chroma map. */
export function cqtOctaveSpec(_octave = 0): SpectrogramSpec {
  const freqs = topFreqs();
  const re: Float64Array[] = [];
  const im: Float64Array[] = [];
  const data = new Float64Array(BPO * 12);
  for (let j = 0; j < BPO; j++) {
    const f = freqs[j] ?? 0;
    const length = (Q * SR_TOP) / f;
    const start = Math.floor(-length / 2);
    const stop = Math.floor(length / 2);
    const count = stop - start;
    const floorLen = Math.floor(length);
    const window = hannPeriodic(floorLen);
    const wr = new Float64Array(FRAME);
    const wi = new Float64Array(FRAME);
    let l1 = 0;
    const sig: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) {
      const phase = ((start + i) * 2 * Math.PI * f) / SR_TOP;
      const w = i < floorLen ? (window[i] ?? 0) : 0;
      sig.push([w * Math.cos(phase), w * Math.sin(phase)]);
      l1 += Math.abs(w);
    }
    const offset = Math.floor((FRAME - count) / 2);
    sig.forEach(([a, b], i) => {
      wr[offset + i] = a / l1;
      wi[offset + i] = b / l1;
    });
    re.push(wr);
    im.push(wi);
    // librosa cq_to_chroma: bin j of an octave is class ((j + 1) mod 36) // 3 (C at j = 0); √length weighting.
    const pc = Math.floor(((j + 1) % BPO) / 3);
    data[j * 12 + pc] = Math.sqrt(length);
  }
  return {
    id: 'cqt',
    frameLength: FRAME,
    transform: { kind: 'filters', re, im },
    projection: { rows: BPO, columns: 12, data },
    output: 'magnitude',
  };
}

/** `firwin(2·half + 1, 1 / factor, window=('kaiser', 5))`, unit gain at DC. */
function lowpass(factor: number, half: number): Float64Array {
  const taps = 2 * half + 1;
  const h = new Float64Array(taps);
  const cutoff = 1 / factor;
  const i0 = (x: number) => {
    let sum = 1;
    let term = 1;
    for (let k = 1; k < 100; k++) {
      term *= (x * x) / 4 / (k * k);
      sum += term;
    }
    return sum;
  };
  let total = 0;
  for (let n = 0; n < taps; n++) {
    const m = n - half;
    const x = cutoff * m;
    const sinc = m === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = m / half;
    h[n] = cutoff * sinc * (i0(5 * Math.sqrt(Math.max(0, 1 - r * r))) / i0(5));
    total += h[n] ?? 0;
  }
  return h.map((v) => v / total);
}

/** resample_poly(x, 1, factor): low-pass, then every factor-th sample, centred. */
export function decimate(x: ArrayLike<number>, factor: number): Float64Array {
  const half = 8 * factor;
  const h = lowpass(factor, half);
  const out = new Float64Array(Math.ceil(x.length / factor));
  for (let m = 0; m < out.length; m++) {
    const centre = m * factor;
    let acc = 0;
    const lo = Math.max(0, centre - half);
    const hi = Math.min(x.length - 1, centre + half);
    for (let i = lo; i <= hi; i++) acc += (h[centre - i + half] ?? 0) * (x[i] ?? 0);
    out[m] = acc;
  }
  return out;
}

/**
 * Per-frame chroma (C first), each frame divided by its largest class (librosa's norm=inf; near-zero frames kept),
 * from a 48 kHz mono signal: [frames, 12] row-major.
 */
export async function cqtChroma(
  mono: ArrayLike<number>,
  runner: SpectrogramRunner,
): Promise<{ chroma: Float64Array; frames: number }> {
  let y = decimate(mono, LISTEN_SR / SR_TOP);
  const frames = 1 + Math.floor(y.length / HOP_TOP);
  const block = new Float32Array(OCTAVES * frames * FRAME);
  let hop = HOP_TOP;
  for (let o = 0; o < OCTAVES; o++) {
    const padded = centredPad(y, FRAME / 2, 'constant');
    const framed = frameSignal(padded, FRAME, hop, frames);
    block.set(framed.frames, o * frames * FRAME);
    if (o < OCTAVES - 1) {
      y = decimate(y, 2);
      hop /= 2;
    }
  }
  const spec = cqtOctaveSpec();
  const out = await runner.spectrogram(spec, { frames: block, count: OCTAVES * frames });
  const chroma = new Float64Array(frames * 12);
  for (let t = 0; t < frames; t++) {
    let top = 0;
    for (let c = 0; c < 12; c++) {
      let v = 0;
      // An octave down has half the rate, so its wavelets are twice as long in time: √2 more per octave.
      for (let o = 0; o < OCTAVES; o++) v += Math.SQRT2 ** o * (out.data[(o * frames + t) * 12 + c] ?? 0);
      chroma[t * 12 + c] = v;
      top = Math.max(top, v);
    }
    if (top >= 1.1754943508222875e-38)
      for (let c = 0; c < 12; c++) chroma[t * 12 + c] = (chroma[t * 12 + c] ?? 0) / top;
  }
  return { chroma, frames };
}
