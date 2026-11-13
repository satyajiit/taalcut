// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The crop path's jitter measures (SPEC P3.10, `cropJitter`), shared by QA and `tools/evals reframe`. One axis
 * at a time, at the output rate, in canvas pixels:
 *
 * - **Hold violation**: a step over `holdStepPx` while the raw point stays within the deadzone of the held
 *   point (the path where the hold began) for at least `holdSeconds`. The smoother holds exactly there, so any
 *   step is a bug or a nervous filter.
 * - **Wobble**: a reversal and a return within `wobbleSeconds` whose two legs are both shorter than the
 *   deadzone: back-and-forth no camera operator would make.
 */
import { REFRAME_CONFIG, type ReframeConfig } from './config';

export interface JitterInput {
  /** The path's position at every output frame (frame 0 first). */
  readonly path: readonly number[];
  /** The raw followed point at sample frames, same units; null where the crop eased to the centre. */
  readonly raw: readonly { readonly frame: number; readonly value: number | null }[];
  readonly deadzone: number;
  readonly fps: number;
  readonly config?: ReframeConfig;
}

export interface JitterReport {
  readonly holdViolations: readonly { readonly frame: number; readonly step: number }[];
  readonly wobbles: readonly { readonly frame: number; readonly legs: readonly [number, number] }[];
}

const pathValue = (path: readonly number[], frame: number) =>
  path[Math.max(0, Math.min(path.length - 1, Math.round(frame)))] ?? 0;

function holdViolations(input: JitterInput, config: ReframeConfig): JitterReport['holdViolations'] {
  const found: { frame: number; step: number }[] = [];
  const samples = input.raw.filter(
    (sample): sample is { frame: number; value: number } => sample.value !== null,
  );
  let start = 0;
  while (start < samples.length) {
    const first = samples[start];
    if (!first) break;
    const held = pathValue(input.path, first.frame);
    let end = start;
    while (
      end + 1 < samples.length &&
      Math.abs((samples[end + 1]?.value ?? Infinity) - held) < input.deadzone
    )
      end++;
    const last = samples[end] ?? first;
    if (
      Math.abs(first.value - held) < input.deadzone &&
      (last.frame - first.frame) / input.fps >= config.holdSeconds
    ) {
      const from = Math.max(0, Math.round(first.frame));
      const to = Math.min(input.path.length - 1, Math.round(last.frame));
      for (let frame = from; frame < to; frame++) {
        const step = Math.abs((input.path[frame + 1] ?? 0) - (input.path[frame] ?? 0));
        if (step > config.holdStepPx) found.push({ frame, step });
      }
    }
    start = end + 1;
  }
  return found;
}

interface Leg {
  readonly start: number;
  readonly end: number;
  readonly sign: number;
  readonly length: number;
}

/** Maximal runs of steps in one direction; frames without movement don't break a run. */
function legs(path: readonly number[]): Leg[] {
  const out: Leg[] = [];
  for (let frame = 0; frame + 1 < path.length; frame++) {
    const step = (path[frame + 1] ?? 0) - (path[frame] ?? 0);
    if (Math.abs(step) < 1e-9) continue;
    const sign = Math.sign(step);
    const last = out[out.length - 1];
    if (last && last.sign === sign)
      out[out.length - 1] = { ...last, end: frame + 1, length: last.length + Math.abs(step) };
    else out.push({ start: frame, end: frame + 1, sign, length: Math.abs(step) });
  }
  return out;
}

function wobbles(input: JitterInput, config: ReframeConfig): JitterReport['wobbles'] {
  const found: { frame: number; legs: [number, number] }[] = [];
  const runs = legs(input.path);
  for (let index = 1; index + 1 < runs.length; index++) {
    const back = runs[index];
    const again = runs[index + 1];
    if (!back || !again) continue;
    const within = (again.start - back.start) / input.fps <= config.wobbleSeconds;
    if (within && back.length < input.deadzone && again.length < input.deadzone)
      found.push({ frame: back.start, legs: [back.length, again.length] });
  }
  return found;
}

export function measureJitter(input: JitterInput): JitterReport {
  const config = input.config ?? REFRAME_CONFIG;
  return { holdViolations: holdViolations(input, config), wobbles: wobbles(input, config) };
}
