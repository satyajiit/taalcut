// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * 48 kHz → 16 kHz for AST. Upstream uses soxr's HQ preset (`audio.resample`); this is a linear-phase Kaiser-windowed
 * sinc decimator fitted to soxr's output (601 taps, cut-off 7.65 kHz, Kaiser β 13.4: 0.14% RMS apart on speech
 * and a film mix, all of it in the 7.3–8 kHz roll-off); zero delay, zeros past both ends, `round(n / 3)` samples out,
 * as soxr gives. The measured effect on AST is in packages/audio/SPEC.md (EAR1 listening: models and calibration).
 */

const FACTOR = 3;
const CUTOFF_HZ = 7650;
const INPUT_RATE = 48_000;
const HALF_TAPS = 300;
const BETA = 13.4;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 60; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

let taps: Float64Array | undefined;

/** h[j] for j in −HALF_TAPS..HALF_TAPS, DC gain 1. */
function kernel(): Float64Array {
  if (taps) return taps;
  const out = new Float64Array(2 * HALF_TAPS + 1);
  const fc = (2 * CUTOFF_HZ) / INPUT_RATE;
  const norm = besselI0(BETA);
  let sum = 0;
  for (let j = -HALF_TAPS; j <= HALF_TAPS; j++) {
    const x = fc * j;
    const sinc = j === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = j / HALF_TAPS;
    const value = fc * sinc * (besselI0(BETA * Math.sqrt(Math.max(0, 1 - r * r))) / norm);
    out[j + HALF_TAPS] = value;
    sum += value;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / sum;
  taps = out;
  return out;
}

/** 48 kHz mono → 16 kHz. The kernel is symmetric, so each output folds the two sides before multiplying. */
export function resample48kTo16k(input: Float32Array): Float32Array {
  const h = kernel();
  const length = Math.round(input.length / FACTOR);
  const out = new Float32Array(length);
  const last = input.length - 1;
  const centreTap = h[HALF_TAPS] ?? 0;
  for (let m = 0; m < length; m++) {
    const c = m * FACTOR;
    let acc = centreTap * (input[c] ?? 0);
    if (c >= HALF_TAPS && c + HALF_TAPS <= last) {
      for (let j = 1; j <= HALF_TAPS; j++) {
        acc += (h[HALF_TAPS + j] ?? 0) * ((input[c - j] ?? 0) + (input[c + j] ?? 0));
      }
    } else {
      for (let j = 1; j <= HALF_TAPS; j++) {
        const left = c - j >= 0 ? (input[c - j] ?? 0) : 0;
        const right = c + j <= last ? (input[c + j] ?? 0) : 0;
        acc += (h[HALF_TAPS + j] ?? 0) * (left + right);
      }
    }
    out[m] = acc;
  }
  return out;
}
