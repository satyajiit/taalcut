// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: how much of its file a clip plays. A clip lasts `duration` canvas frames; in real time it plays exactly
 * that much of the file, and a speed ramp plays its integral. The timeline package owns this sum
 * (model/speed.ts) and the renderer may not import it, so the same integral is restated here, for drawing and for
 * limits only: the commands work the real numbers out again, and a difference of a frame is theirs to refuse.
 */
import type { SpeedRamp } from '@taalcut/core';

type Point = SpeedRamp['points'][number];

/** The speed's integral over the first `u` of one segment `len` canvas frames long, in canvas frames of file time. */
function segment(curve: SpeedRamp['curve'], from: Point, to: Point, len: number, u: number): number {
  const rise = to.speed - from.speed;
  if (curve === 'hold') return len * from.speed * u;
  // "ease" is smoothstep 3u² − 2u³: its integral from 0 to u is u³ − u⁴/2.
  const shape = curve === 'linear' ? (u * u) / 2 : u ** 3 - u ** 4 / 2;
  return len * (from.speed * u + rise * shape);
}

function integral(ramp: SpeedRamp, frames: number): number {
  if (frames < 0) return frames * (ramp.points[0]?.speed ?? 1);
  let total = 0;
  for (const [index, point] of ramp.points.entries()) {
    const start = point.at.value;
    if (frames <= start) break;
    const next = ramp.points[index + 1];
    if (!next) {
      total += (frames - start) * point.speed;
      break;
    }
    const len = next.at.value - start;
    total += segment(ramp.curve, point, next, len, Math.min(1, (frames - start) / len));
  }
  return total;
}

/** File time, in canvas frames, played over a clip's first `frames` canvas frames: `frames` itself in real time. */
export function playedFrames(ramp: SpeedRamp | null, frames: number): number {
  if (!ramp) return frames;
  const offset = ramp.windowStart?.value ?? 0;
  return integral(ramp, offset + frames) - integral(ramp, offset);
}

/** The speed at canvas frame `frame` of the clip: 1 in real time. */
export function speedAtFrame(ramp: SpeedRamp | null, frame: number): number {
  if (!ramp) return 1;
  const at = frame + (ramp.windowStart?.value ?? 0);
  for (let index = ramp.points.length - 1; index >= 0; index -= 1) {
    const point = ramp.points[index]!;
    if (at < point.at.value) continue;
    const next = ramp.points[index + 1];
    if (!next || ramp.curve === 'hold') return point.speed;
    const u = Math.min(1, (at - point.at.value) / (next.at.value - point.at.value));
    const shape = ramp.curve === 'linear' ? u : 3 * u * u - 2 * u ** 3;
    return point.speed + (next.speed - point.speed) * shape;
  }
  return ramp.points[0]?.speed ?? 1;
}
