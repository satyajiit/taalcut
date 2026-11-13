// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a spectrogram computes, said once so the GPU graph and the CPU oracle can each build it their own way: a
 * windowed DFT over a range of bins (the graph as a MatMul with a basis, the oracle with an FFT) or a bank of
 * complex filters (the constant-Q wavelets), then power, magnitude or dB, with an optional projection (a mel or
 * chroma matrix) between. Also the framing rules upstream uses (NumPy's centred reflect pad and its kin).
 */

export type SpectralOutput = 'power' | 'magnitude' | 'db';

/** X_k = Σ_n window[n]·x[n]·e^{−2πi k n / nFft}, for k in firstBin .. firstBin + bins − 1 (frame zero-padded to nFft). */
export interface DftTransform {
  readonly kind: 'dft';
  readonly nFft: number;
  readonly window: Float64Array;
  readonly firstBin: number;
  readonly bins: number;
}

/** X_k = Σ_n x[n]·conj(filter_k[n]); each filter is `frameLength` long. */
export interface FilterBankTransform {
  readonly kind: 'filters';
  readonly re: readonly Float64Array[];
  readonly im: readonly Float64Array[];
}

export type SpectralTransform = DftTransform | FilterBankTransform;

/** A [rows, columns] matrix applied after power or magnitude (rows = the transform's bins). */
export interface Projection {
  readonly rows: number;
  readonly columns: number;
  readonly data: Float64Array;
}

/** One spectrogram: `id` names the graph (sessions are reused by it), frames are row-major [count, frameLength]. */
export interface SpectrogramSpec {
  readonly id: string;
  readonly frameLength: number;
  readonly transform: SpectralTransform;
  readonly projection?: Projection;
  readonly output: SpectralOutput;
}

export interface FrameBlock {
  readonly frames: Float32Array;
  readonly count: number;
}

export interface SpectrogramResult {
  /** Row-major [frames, columns]. */
  readonly data: Float32Array;
  readonly frames: number;
  readonly columns: number;
  /** Where it ran: an accelerated backend, or 'cpu' (the oracle). */
  readonly backend: string;
}

export function transformBins(t: SpectralTransform): number {
  return t.kind === 'dft' ? t.bins : t.re.length;
}

export function outputColumns(spec: SpectrogramSpec): number {
  return spec.projection ? spec.projection.columns : transformBins(spec.transform);
}

/** The graph's basis, [frameLength, bins] row-major in float32, window baked in. */
export function basisOf(spec: SpectrogramSpec): { re: Float32Array; im: Float32Array; bins: number } {
  const t = spec.transform;
  const length = spec.frameLength;
  const bins = transformBins(t);
  const re = new Float32Array(length * bins);
  const im = new Float32Array(length * bins);
  if (t.kind === 'dft') {
    for (let n = 0; n < length; n++) {
      const w = t.window[n] ?? 0;
      for (let b = 0; b < bins; b++) {
        const k = t.firstBin + b;
        // (k·n) mod nFft keeps the angle small, so the basis is exact to float32.
        const angle = (2 * Math.PI * ((k * n) % t.nFft)) / t.nFft;
        re[n * bins + b] = w * Math.cos(angle);
        im[n * bins + b] = -w * Math.sin(angle);
      }
    }
    return { re, im, bins };
  }
  for (let b = 0; b < bins; b++) {
    const fr = t.re[b] as Float64Array;
    const fi = t.im[b] as Float64Array;
    for (let n = 0; n < length; n++) {
      re[n * bins + b] = fr[n] ?? 0;
      im[n * bins + b] = -(fi[n] ?? 0);
    }
  }
  return { re, im, bins };
}

/** NumPy `np.pad(m, (half, half), mode)`: 'reflect' does not repeat the edge sample. */
export function centredPad(m: ArrayLike<number>, half: number, mode: 'reflect' | 'constant'): Float32Array {
  const n = m.length;
  const out = new Float32Array(n + 2 * half);
  for (let i = 0; i < n; i++) out[half + i] = m[i] ?? 0;
  if (mode === 'constant' || n <= 1) return out;
  const period = 2 * (n - 1);
  const at = (i: number) => {
    let j = ((i % period) + period) % period;
    if (j >= n) j = period - j;
    return m[j] ?? 0;
  };
  for (let i = 0; i < half; i++) {
    out[i] = at(i - half);
    out[half + n + i] = at(n + i);
  }
  return out;
}

/** Frames of `length` at `hop` from `start`, as many as fit: [count, length] row-major. */
export function frameSignal(y: ArrayLike<number>, length: number, hop: number, count?: number): FrameBlock {
  const fit = y.length >= length ? 1 + Math.floor((y.length - length) / hop) : 0;
  const n = count ?? fit;
  const frames = new Float32Array(n * length);
  for (let f = 0; f < n; f++) {
    const s = f * hop;
    const row = f * length;
    const end = Math.max(0, Math.min(length, y.length - s));
    if (y instanceof Float32Array) frames.set(y.subarray(s, s + end), row);
    else for (let i = 0; i < end; i++) frames[row + i] = y[s + i] ?? 0;
  }
  return { frames, count: n };
}

/**
 * Upstream's centred spectrogram framing (`log_mel`): pad n_fft/2 each side (reflect when the signal is longer than
 * n_fft, else zeros), then 1 + (len(y) − n_fft) // hop frames.
 */
export function centredFrames(
  m: ArrayLike<number>,
  nFft: number,
  hop: number,
  mode?: 'reflect' | 'constant',
): FrameBlock {
  const pad = centredPad(m, nFft / 2, mode ?? (m.length > nFft ? 'reflect' : 'constant'));
  return frameSignal(pad, nFft, hop);
}
