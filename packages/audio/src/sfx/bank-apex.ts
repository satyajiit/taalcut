// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A sound's apex (EAR1-D2): the centre of its loudest 5 ms, the 5 ms RMS window searched at every sample, the
 * first maximum on a tie. earshot's `bank.times` searches a 1 ms grid from the file's start; this is the same
 * window without the grid, so it moves sample for sample with the sound wherever it is placed (a fluttering pass
 * has near-equal maxima a grid shift can swap). The bank build stores it per take as `apexMs`; a take edited at run
 * time, and a test measuring a rendered timeline, measure it here.
 */

const WINDOW = 240; // 5 ms at 48 kHz

/** Seconds from the start of `mono` (48 kHz) to the centre of its loudest 5 ms. */
export function apexSeconds(mono: ArrayLike<number>, sampleRate = 48_000): number {
  const n = mono.length;
  const w = Math.round((WINDOW * sampleRate) / 48_000);
  if (n <= w) return n / 2 / sampleRate;
  let energy = 0;
  for (let i = 0; i < w; i++) energy += (mono[i] ?? 0) ** 2;
  let best = energy;
  let at = 0;
  // A running sum drifts; it is re-summed every second so a long quiet tail can't win on rounding.
  for (let s = 1; s + w <= n; s++) {
    const out = mono[s - 1] ?? 0;
    const into = mono[s + w - 1] ?? 0;
    energy += into * into - out * out;
    if (s % sampleRate === 0) {
      energy = 0;
      for (let i = s; i < s + w; i++) energy += (mono[i] ?? 0) ** 2;
    }
    if (energy > best) {
      best = energy;
      at = s;
    }
  }
  return (at + w / 2) / sampleRate;
}
