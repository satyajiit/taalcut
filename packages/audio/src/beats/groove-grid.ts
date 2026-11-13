// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Musical groove & sub-beat grid generator (`buildGrooveGrid`, `snapTimeToGroove`).
 * Subdivides a `BeatGrid` into downbeats, quarter-notes (`1/1`), eighth-notes (`1/2`), sixteenth-notes (`1/4`),
 * or thirty-second-notes (`1/8`) with optional swing ratio (`0.5` straight to `0.67` triplet swing) so cuts,
 * speed-ramps, and motion graphics can lock to sub-beat grooves.
 */
import type { GrooveSubdivision } from '@taalcut/core';
import { downbeatTimes, type BeatGrid } from '../music/beat-grid';

export interface GroovePoint {
  readonly ms: number;
  readonly kind: 'downbeat' | 'beat' | 'subbeat';
  /** Accent weight in [0.25, 1.0]: 1.0 for downbeats, 0.75 for main beats, 0.45 for off-beats, 0.25 for 16th/32nd. */
  readonly weight: number;
}

export interface GrooveGrid {
  readonly subdivision: GrooveSubdivision;
  readonly swing: number;
  readonly points: readonly GroovePoint[];
}

export interface SnapGrooveResult {
  readonly originalMs: number;
  readonly snappedMs: number;
  readonly deltaMs: number;
  readonly snapped: boolean;
  readonly point: GroovePoint | null;
}

const SUBDIVISION_STEPS: Readonly<Record<GrooveSubdivision, number>> = {
  downbeat: 0,
  '1/1': 1,
  '1/2': 2,
  '1/4': 4,
  '1/8': 8,
};

/**
 * Builds a subdivided `GrooveGrid` from a `BeatGrid`.
 * `swing` in `[0.5, 0.67]` delays odd sub-divisions (0.5 = straight timing, 0.667 = triplet shuffle).
 */
export function buildGrooveGrid(
  grid: BeatGrid,
  subdivision: GrooveSubdivision = '1/1',
  swing = 0.5,
): GrooveGrid {
  const clampedSwing = Math.max(0.5, Math.min(0.67, swing));
  const downbeatSet = new Set(grid.downbeats);
  if (subdivision === 'downbeat') {
    return {
      subdivision,
      swing: clampedSwing,
      points: downbeatTimes(grid).map((ms) => ({ ms, kind: 'downbeat', weight: 1.0 })),
    };
  }

  const steps = SUBDIVISION_STEPS[subdivision];
  const points: GroovePoint[] = [];
  for (let i = 0; i < grid.beatsMs.length; i++) {
    const startMs = grid.beatsMs[i]!;
    const isDown = downbeatSet.has(i);
    points.push({
      ms: startMs,
      kind: isDown ? 'downbeat' : 'beat',
      weight: isDown ? 1.0 : 0.75,
    });
    const nextMs = grid.beatsMs[i + 1];
    if (nextMs === undefined || nextMs <= startMs || steps <= 1) continue;
    const span = nextMs - startMs;
    for (let s = 1; s < steps; s++) {
      // Apply swing offset to odd subdivisions
      const baseShare = s / steps;
      const swingShift = s % 2 === 1 ? ((clampedSwing - 0.5) * 2) / steps : 0;
      const share = Math.min(0.95, baseShare + swingShift);
      const isHalfBeat = s * 2 === steps;
      points.push({
        ms: Math.round((startMs + span * share) * 100) / 100,
        kind: 'subbeat',
        weight: isHalfBeat ? 0.45 : 0.25,
      });
    }
  }
  return { subdivision, swing: clampedSwing, points };
}

/**
 * Snaps `targetMs` to the highest-priority groove point within ` ±maxWindowMs` (default 80 ms).
 * When a downbeat and a weak subbeat are both inside the window, accent weight breaks ties toward the stronger beat.
 */
export function snapTimeToGroove(
  targetMs: number,
  groove: GrooveGrid,
  maxWindowMs = 80,
): SnapGrooveResult {
  if (groove.points.length === 0 || maxWindowMs <= 0) {
    return { originalMs: targetMs, snappedMs: targetMs, deltaMs: 0, snapped: false, point: null };
  }
  let best: GroovePoint | null = null;
  let bestScore = -Infinity;

  for (const pt of groove.points) {
    const dist = Math.abs(pt.ms - targetMs);
    if (dist > maxWindowMs) continue;
    const proximity = 1 - dist / maxWindowMs;
    const score = proximity * 0.7 + pt.weight * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = pt;
    }
  }
  if (!best) {
    return { originalMs: targetMs, snappedMs: targetMs, deltaMs: 0, snapped: false, point: null };
  }
  const deltaMs = Math.round((best.ms - targetMs) * 100) / 100;
  return {
    originalMs: targetMs,
    snappedMs: best.ms,
    deltaMs,
    snapped: true,
    point: best,
  };
}
