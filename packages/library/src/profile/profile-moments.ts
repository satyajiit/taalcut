// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: a shot's moments as its profile carries them (core's `ShotProfileMoment`): the stretches vision's describe
 * stage stored with the description (`analysis.description.moments`), on the profile's own frame grid, each with the
 * vector of its note (`moment:<shotId>:<n>` in the active embedding space; null until embedded). Casting's in-point
 * step weighs a window by them, and the timeline's tools show them to the model. MOM2: a stretch the describer
 * stated as the camera being handled keeps that word (`handling`).
 */
import type { ShotAnalysis, ShotProfileMoment, TimeRange } from '@taalcut/core';

export const momentVectorId = (shotId: string, n: number): string => `moment:${shotId}:${n}`;

/** The vector ids of a shot's stored moments, in order. */
export function momentVectorIds(shotId: string, analysis: ShotAnalysis | null): string[] {
  return (analysis?.description?.moments ?? []).map((_, n) => momentVectorId(shotId, n));
}

/**
 * The stored moments over `range` (the shot at the asset's rate), or null when the shot has none. They were written
 * in frames of the grid vision described the shot on; when that grid isn't the range's (a file whose stated rate
 * differs from its shots'), they are scaled onto it, so they always cover the shot from its first frame to its last.
 */
export function profileMoments(
  shotId: string,
  analysis: ShotAnalysis | null,
  range: TimeRange,
  vectors: ReadonlyMap<string, Float32Array>,
): ShotProfileMoment[] | null {
  const stored = analysis?.description?.moments;
  const length = range.duration.value;
  const total = stored?.at(-1)?.end ?? 0;
  if (!stored || stored.length === 0 || !(length > 0) || !(total > 0)) return null;
  const onGrid = (frame: number) => (total === length ? frame : Math.round((frame * length) / total));
  const moments = stored.flatMap((moment, n): ShotProfileMoment[] => {
    const start = onGrid(moment.start);
    const end = n === stored.length - 1 ? length : onGrid(moment.end);
    return end > start
      ? [
          {
            start,
            end,
            note: moment.note,
            vector: vectors.get(momentVectorId(shotId, n)) ?? null,
            ...(moment.handling ? { handling: true as const } : {}),
          },
        ]
      : [];
  });
  return moments.length > 0 ? moments : null;
}
