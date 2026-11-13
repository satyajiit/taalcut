// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The 1€ filter (Casiez, Roussel and Vogel, "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in
 * Interactive Systems", CHI 2012, doi:10.1145/2207676.2208639), reimplemented from the paper's equations; no
 * reference code is vendored. A first-order low pass whose cutoff rises with the filtered speed, so a held
 * subject is still and a moving one lags little. It runs on real sample timestamps: detection is not exactly
 * 4 Hz, and a tracker sample sits between detections.
 *
 *   τ(f) = 1 / (2πf),  α(f) = 1 / (1 + τ/Δt)
 *   ẋ = (x − x̂ₚ)/Δt,  ẋ̂ = α(d)·ẋ + (1 − α(d))·ẋ̂ₚ
 *   f = fmin + β·|ẋ̂|,  x̂ = α(f)·x + (1 − α(f))·x̂ₚ
 */

export interface OneEuroParams {
  /** The cutoff at rest, Hz: lower is stiller and lags more. */
  readonly minCutoffHz: number;
  /** How much speed raises the cutoff (per unit of the input per second). */
  readonly beta: number;
  /** The cutoff of the speed estimate, Hz. */
  readonly dCutoffHz: number;
}

/** α for a cutoff over a time step: the share of the new sample in the output. */
export function smoothingFactor(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

export interface OneEuroFilter {
  /** Filters `value` sampled at `tSeconds`; the first call returns the value itself. */
  filter(value: number, tSeconds: number): number;
  /**
   * Moves the filter to `value` at `tSeconds` without a step: the caller is holding still (the deadzone), so
   * the speed estimate decays as for zero motion and the next real sample filters from the held value.
   */
  hold(value: number, tSeconds: number): void;
}

export function createOneEuroFilter(params: OneEuroParams): OneEuroFilter {
  let previous: { readonly x: number; readonly dx: number; readonly t: number } | null = null;
  return {
    filter(value, tSeconds) {
      if (!previous) {
        previous = { x: value, dx: 0, t: tSeconds };
        return value;
      }
      const dt = tSeconds - previous.t;
      // Two samples at one instant: keep what we have rather than divide by zero.
      if (dt <= 0) return previous.x;
      const speed = (value - previous.x) / dt;
      const alphaD = smoothingFactor(params.dCutoffHz, dt);
      const dx = alphaD * speed + (1 - alphaD) * previous.dx;
      const cutoff = params.minCutoffHz + params.beta * Math.abs(dx);
      const alpha = smoothingFactor(cutoff, dt);
      const x = alpha * value + (1 - alpha) * previous.x;
      previous = { x, dx, t: tSeconds };
      return x;
    },
    hold(value, tSeconds) {
      if (!previous) {
        previous = { x: value, dx: 0, t: tSeconds };
        return;
      }
      const dt = tSeconds - previous.t;
      const alphaD = dt > 0 ? smoothingFactor(params.dCutoffHz, dt) : 0;
      previous = { x: value, dx: (1 - alphaD) * previous.dx, t: Math.max(previous.t, tSeconds) };
    },
  };
}
