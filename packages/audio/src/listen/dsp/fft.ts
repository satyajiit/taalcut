// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * f64 FFTs for the CPU side of the listen DSP: the spectrogram oracles (the tests' reference and the logged CPU
 * fallback) and the single-window transforms that stay on the CPU (an event's spectrum, the audit's cepstrum).
 * Radix-2 for powers of two; any other length by Bluestein's chirp-z over a power of two, as NumPy's pocketfft
 * takes any length. Twiddle tables are memoised per size: immutable data, not state.
 */

interface Plan {
  readonly n: number;
  readonly reverse: Uint32Array;
  readonly cos: Float64Array;
  readonly sin: Float64Array;
}

const plans = new Map<number, Plan>();

function planOf(n: number): Plan {
  const hit = plans.get(n);
  if (hit) return hit;
  const bits = Math.round(Math.log2(n));
  const reverse = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    reverse[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const plan = { n, reverse, cos, sin };
  plans.set(n, plan);
  return plan;
}

export function isPowerOfTwo(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** In-place complex FFT of a power-of-two length; `inverse` uses e^{+i} and does not scale. */
export function fftInPlace(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n <= 1) return;
  if (!isPowerOfTwo(n)) throw new Error(`fftInPlace needs a power of two, got ${n}`);
  const { reverse, cos, sin } = planOf(n);
  for (let i = 0; i < n; i++) {
    const j = reverse[i] ?? 0;
    if (j > i) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let span = 2; span <= n; span <<= 1) {
    const half = span >> 1;
    const step = n / span;
    for (let start = 0; start < n; start += span) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step] ?? 1;
        const wi = sign * (sin[k * step] ?? 0);
        const a = start + k;
        const b = a + half;
        const br = re[b] ?? 0;
        const bi = im[b] ?? 0;
        const tr = br * wr - bi * wi;
        const ti = br * wi + bi * wr;
        const ar = re[a] ?? 0;
        const ai = im[a] ?? 0;
        re[b] = ar - tr;
        im[b] = ai - ti;
        re[a] = ar + tr;
        im[a] = ai + ti;
      }
    }
  }
}

/** Forward DFT of any length (Bluestein when not a power of two), in place. */
export function dftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (isPowerOfTwo(n)) {
    fftInPlace(re, im);
    return;
  }
  const m = nextPowerOfTwo(2 * n - 1);
  const wr = new Float64Array(n);
  const wi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    // k² mod 2n keeps the angle exact for long transforms.
    const angle = (Math.PI * ((k * k) % (2 * n))) / n;
    wr[k] = Math.cos(angle);
    wi[k] = Math.sin(angle);
  }
  const ar = new Float64Array(m);
  const ai = new Float64Array(m);
  for (let k = 0; k < n; k++) {
    const xr = re[k] ?? 0;
    const xi = im[k] ?? 0;
    const cr = wr[k] ?? 0;
    const ci = -(wi[k] ?? 0);
    ar[k] = xr * cr - xi * ci;
    ai[k] = xr * ci + xi * cr;
  }
  const br = new Float64Array(m);
  const bi = new Float64Array(m);
  br[0] = wr[0] ?? 1;
  bi[0] = wi[0] ?? 0;
  for (let k = 1; k < n; k++) {
    br[k] = br[m - k] = wr[k] ?? 0;
    bi[k] = bi[m - k] = wi[k] ?? 0;
  }
  fftInPlace(ar, ai);
  fftInPlace(br, bi);
  for (let k = 0; k < m; k++) {
    const xr = ar[k] ?? 0;
    const xi = ai[k] ?? 0;
    const yr = br[k] ?? 0;
    const yi = bi[k] ?? 0;
    ar[k] = xr * yr - xi * yi;
    ai[k] = xr * yi + xi * yr;
  }
  fftInPlace(ar, ai, true);
  for (let k = 0; k < n; k++) {
    const xr = (ar[k] ?? 0) / m;
    const xi = (ai[k] ?? 0) / m;
    const cr = wr[k] ?? 0;
    const ci = -(wi[k] ?? 0);
    re[k] = xr * cr - xi * ci;
    im[k] = xr * ci + xi * cr;
  }
}

/** One-sided spectrum (k = 0..n/2) of `input` cropped or zero-padded to `n`, as `np.fft.rfft(input, n)`. */
export function rfft(input: ArrayLike<number>, n: number): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const count = Math.min(n, input.length);
  for (let i = 0; i < count; i++) re[i] = input[i] ?? 0;
  dftInPlace(re, im);
  const bins = Math.floor(n / 2) + 1;
  return { re: re.subarray(0, bins), im: im.subarray(0, bins) };
}

/** `|rfft(input, n)|²`. */
export function rfftPower(input: ArrayLike<number>, n: number): Float64Array {
  const { re, im } = rfft(input, n);
  const out = new Float64Array(re.length);
  for (let k = 0; k < re.length; k++) out[k] = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
  return out;
}

/** Linear autocorrelation `r[lag]`, lag 0..n-1 (as `irfft(|rfft(x, 2n)|²)[:n]`). */
export function autocorrelation(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const m = nextPowerOfTwo(Math.max(2, 2 * n));
  const re = new Float64Array(m);
  const im = new Float64Array(m);
  for (let i = 0; i < n; i++) re[i] = x[i] ?? 0;
  fftInPlace(re, im);
  for (let k = 0; k < m; k++) {
    re[k] = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
    im[k] = 0;
  }
  fftInPlace(re, im, true);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (re[i] ?? 0) / m;
  return out;
}

/** NumPy's `np.hanning(n)` (symmetric). */
export function hanningSymmetric(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** SciPy's `get_window('hann', n)` (periodic, the DFT-even window `stft` and `welch` use). */
export function hannPeriodic(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** `np.fft.rfftfreq(n, 1 / sr)`. */
export function rfftFreqs(n: number, sr: number): Float64Array {
  const bins = Math.floor(n / 2) + 1;
  const f = new Float64Array(bins);
  for (let k = 0; k < bins; k++) f[k] = (k * sr) / n;
  return f;
}

/** A reusable n-point real FFT (n a power of two ≥ 4) through one n/2-point complex FFT. */
export interface RealFftPlan {
  readonly n: number;
  /** Fills re/im (length n/2 + 1) with the one-sided spectrum of `input` (length n). */
  transform(input: ArrayLike<number>, re: Float64Array, im: Float64Array): void;
}

export function realFftPlan(n: number): RealFftPlan {
  if (n < 4 || !isPowerOfTwo(n)) throw new Error(`realFftPlan needs a power of two ≥ 4, got ${n}`);
  const h = n / 2;
  const zr = new Float64Array(h);
  const zi = new Float64Array(h);
  const wr = new Float64Array(h + 1);
  const wi = new Float64Array(h + 1);
  for (let k = 0; k <= h; k++) {
    wr[k] = Math.cos((2 * Math.PI * k) / n);
    wi[k] = -Math.sin((2 * Math.PI * k) / n);
  }
  return {
    n,
    transform(input, re, im) {
      for (let m = 0; m < h; m++) {
        zr[m] = input[2 * m] ?? 0;
        zi[m] = input[2 * m + 1] ?? 0;
      }
      fftInPlace(zr, zi);
      for (let k = 0; k <= h; k++) {
        const a = k % h;
        const b = (h - k) % h;
        const ar = zr[a] ?? 0;
        const ai = zi[a] ?? 0;
        const br = zr[b] ?? 0;
        const bi = -(zi[b] ?? 0);
        // Even part (Z[k] + conj Z[h−k]) / 2, odd part (Z[k] − conj Z[h−k]) / 2i.
        const er = (ar + br) / 2;
        const ei = (ai + bi) / 2;
        const or = (ai - bi) / 2;
        const oi = -(ar - br) / 2;
        const c = wr[k] ?? 1;
        const s = wi[k] ?? 0;
        re[k] = er + (or * c - oi * s);
        im[k] = ei + (or * s + oi * c);
      }
    },
  };
}
