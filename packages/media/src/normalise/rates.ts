// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The frame grid every decode conforms to. Within 2% of a common rate we snap,
 * so 29.97 and 23.976 land on the NTSC fraction instead of a nearby float.
 * Anything else (a 15 fps screen recording) keeps its exact average.
 */
import { FrameRate, type FrameRate as Rate } from '@taalcut/core';
import type { Rational } from '../rational';
import type { SpeedKind } from '@taalcut/core';

const GRID: readonly Rate[] = [
  FrameRate.of(24_000, 1001),
  FrameRate.of(24),
  FrameRate.of(25),
  FrameRate.of(30_000, 1001),
  FrameRate.of(30),
  FrameRate.of(48),
  FrameRate.of(50),
  FrameRate.of(60_000, 1001),
  FrameRate.of(60),
];

const SNAP = 0.02;

export function snapRate(average: Rational): Rate {
  const fps = average.num / average.den;
  let best = GRID[0] ?? FrameRate.of(30);
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const rate of GRID) {
    const target = rate.num / rate.den;
    const delta = Math.abs(fps - target) / target;
    if (delta < bestDelta) {
      best = rate;
      bestDelta = delta;
    }
  }
  if (bestDelta <= SNAP) return best;
  return FrameRate.of(average.num, average.den);
}

export interface GridChoice {
  readonly output: Rate;
  readonly native?: Rate;
  readonly captureRate?: Rate;
  readonly speed: { readonly kind: SpeedKind; readonly factor: number; readonly retimedInFile: boolean };
}

function rateFromFps(fps: number): Rate {
  const parsed = FrameRate.fromFps(fps);
  return parsed.ok ? parsed.value : FrameRate.of(Math.max(1, Math.round(fps)));
}

function clampFactor(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.min(1000, factor);
}

/**
 * A phone's variable frame timing averages a little off the rate it shot at (a 30 fps phone clip can average under 29):
 * within this share of its capture rate, the clip is normal speed on the capture rate's grid (LIB1-FIX).
 */
const CAPTURE_SPREAD = 0.05;

/**
 * How far the capture rate must sit from the stream's for the file to be retimed: slow motion is shot at least about
 * twice as fast as it plays (60 for 30, 48 for 25, 120 and up), a time-lapse at most about half. Anything nearer is
 * timing, such as a low-light clip that dropped frames, never a speed change.
 */
const RETIMED_RATIO = 1.9;

/**
 * iPhone high-frame-rate video is real-time at the stream rate, so playback drops to 30 and keeps the native rate.
 * Android `capture.fps` well above the stream means the file is already slowed; well below it, the file is a
 * time-lapse; near it, a normal clip, on the capture rate's grid when the average is within CAPTURE_SPREAD of it.
 */
export function gridFor(average: Rational, captureFps?: number): GridChoice {
  const snapped = snapRate(average);
  const nativeFps = average.num / average.den;
  const capture =
    captureFps !== undefined && Number.isFinite(captureFps) && captureFps > 0 ? captureFps : undefined;
  if (capture !== undefined && capture >= nativeFps * RETIMED_RATIO) {
    const rate = rateFromFps(capture);
    return {
      output: snapped,
      native: rate,
      captureRate: rate,
      speed: { kind: 'slow-motion', factor: clampFactor(capture / nativeFps), retimedInFile: true },
    };
  }
  if (capture !== undefined && capture * RETIMED_RATIO <= nativeFps) {
    const rate = rateFromFps(capture);
    return {
      output: snapped,
      native: rate,
      captureRate: rate,
      speed: { kind: 'time-lapse', factor: clampFactor(nativeFps / capture), retimedInFile: true },
    };
  }
  if (nativeFps >= 100) {
    const native = FrameRate.of(average.num, average.den);
    return {
      output: FrameRate.of(30),
      native,
      captureRate: native,
      speed: { kind: 'slow-motion', factor: clampFactor(nativeFps / 30), retimedInFile: false },
    };
  }
  const normal = { kind: 'normal' as const, factor: 1, retimedInFile: false };
  if (capture !== undefined && Math.abs(nativeFps - capture) <= capture * CAPTURE_SPREAD) {
    return { output: snapRate({ num: Math.round(capture * 1000), den: 1000 }), speed: normal };
  }
  return { output: snapped, speed: normal };
}
