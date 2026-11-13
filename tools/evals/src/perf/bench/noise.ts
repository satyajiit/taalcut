// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When a bench run is noisy (IX-B1). A noisy run stays in the median; it is named with its reasons so a
 * reader can weigh it. The limits, and why:
 *
 * - Security agents above 200% of one core on average while indexing ran. The plan measured Sophos and
 *   FortiClient at about 170% on this Mac in steady state (indexing-speed-plan.md section 1), and a
 *   two-minute sample on 2026-10-17 at load 15–31 read 170–270% (bench/baseline/README.md): above two
 *   cores they are scanning a burst of someone's files and take that time from the run.
 * - A one-minute load average at the start above the Mac's performance cores (6 on the M5 Max): the run
 *   began while other work already kept every performance core busy, which is where the jobs process's
 *   FFmpeg, whisper and ONNX Runtime threads run. The Phase 3 quiet runs began at 5–6.
 * - A mean load while indexing above the logical cores: more runnable threads than cores, so the run's
 *   own work queued behind other work for the whole window.
 * - Commands from outside the test reached the app (a person or another agent clicking on its window):
 *   the run's numbers include that work and the UI may have moved (IX-B5).
 * - Fewer process samples than half the window's seconds: the sampler itself was starved.
 * - The macOS media daemons (mediaanalysisd analysing the user's Photos, photoanalysisd, Spotlight) above one core
 *   on average: they use Vision, the Neural Engine and VideoToolbox, the hardware OCR and decode run on.
 *   mediaanalysisd was seen at about 110% for hours after a boot (2026-10-17); it is never stopped or throttled.
 * - The bench was set up with the mac helper but it never ran: the run read no on-screen text and timed less
 *   work than the others (mac-helper.ts).
 */
import type { ProcessSummary } from './processes';

export const NOISE_LIMITS = {
  securityMeanCpuPercent: 200,
  backgroundMeanCpuPercent: 100,
  /** Of the performance cores (all cores when the probe gave none). */
  startLoadPerPerformanceCore: 1,
  meanLoadPerCore: 1,
  minSampleShare: 0.5,
} as const;

export interface Noise {
  readonly noisy: boolean;
  readonly reasons: readonly string[];
}

export interface NoiseInputs {
  readonly security: ProcessSummary['security'];
  readonly background: ProcessSummary['background'];
  readonly loadAtStart: number | null;
  readonly loadMean: number | null;
  readonly cores: number;
  readonly performanceCores: number | null;
  readonly windowMs: number;
  readonly processSamples: number;
  readonly foreignCommands: readonly string[];
  /** Set up with the mac helper, yet no process sample shows it. */
  readonly helperMissing: boolean;
}

export function noiseOf(inputs: NoiseInputs): Noise {
  const reasons: string[] = [];
  const security = inputs.security?.meanPercent;
  if (security !== undefined && security > NOISE_LIMITS.securityMeanCpuPercent)
    reasons.push(
      `security agents averaged ${Math.round(security)}% CPU (limit ${NOISE_LIMITS.securityMeanCpuPercent}%)`,
    );
  const background = inputs.background;
  if (background && background.meanPercent > NOISE_LIMITS.backgroundMeanCpuPercent) {
    const busiest = Object.entries(background.byGroup).sort((a, b) => b[1].meanPercent - a[1].meanPercent)[0];
    reasons.push(
      `media daemons averaged ${Math.round(background.meanPercent)}% CPU` +
        `${busiest ? ` (${busiest[0]} ${Math.round(busiest[1].meanPercent)}%)` : ''}` +
        ` (limit ${NOISE_LIMITS.backgroundMeanCpuPercent}%)`,
    );
  }
  const performance = inputs.performanceCores ?? inputs.cores;
  const startLimit = performance * NOISE_LIMITS.startLoadPerPerformanceCore;
  if (inputs.loadAtStart !== null && inputs.loadAtStart > startLimit)
    reasons.push(
      `load ${inputs.loadAtStart.toFixed(1)} at the start (limit ${startLimit}, the performance cores)`,
    );
  const meanLimit = inputs.cores * NOISE_LIMITS.meanLoadPerCore;
  if (inputs.loadMean !== null && inputs.loadMean > meanLimit)
    reasons.push(`mean load ${inputs.loadMean.toFixed(1)} while indexing (limit ${meanLimit}, the cores)`);
  if (inputs.foreignCommands.length > 0)
    reasons.push(`input from outside the test: ${inputs.foreignCommands.join(', ')}`);
  const expected = inputs.windowMs / 1000;
  if (expected >= 10 && inputs.processSamples < expected * NOISE_LIMITS.minSampleShare)
    reasons.push(`${inputs.processSamples} process samples in ${Math.round(expected)} s`);
  if (inputs.helperMissing) reasons.push('the mac helper never ran: no on-screen text was read');
  return { noisy: reasons.length > 0, reasons };
}
