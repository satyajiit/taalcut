// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An f64 power spectrum for the front-end oracles (CPU reference and CPU fallback) and the sections' novelty curve,
 * on the listen DSP's radix-2 FFT (dsp/fft.ts), so the package has one FFT. NumPy's rfft is f64 too; the HF
 * extractors then store the spectrum as complex64, a rounding far below the parity tolerances.
 */
import { fftInPlace, isPowerOfTwo } from '../dsp/fft';

export interface RealFft {
  readonly size: number;
  /** `power[k] = |X[k]|²` for k in 0..size/2, of `input` (length `size`, zero beyond what is set). */
  power(input: Float64Array, power: Float64Array): void;
}

export function createRealFft(size: number): RealFft {
  if (size < 2 || !isPowerOfTwo(size)) throw new Error(`FFT size must be a power of two: ${size}`);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  return {
    size,
    power(input, power) {
      for (let i = 0; i < size; i++) {
        re[i] = input[i] ?? 0;
        im[i] = 0;
      }
      fftInPlace(re, im);
      for (let k = 0; k <= size / 2; k++) {
        const r = re[k] ?? 0;
        const i = im[k] ?? 0;
        power[k] = r * r + i * i;
      }
    },
  };
}
