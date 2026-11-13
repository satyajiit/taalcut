// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which detector decided each clip (IX2-S7). `vision.shots` falls back to scdet when the model fails on a clip and
 * still succeeds, so a TransNetV2 run can hold scdet's boundaries. Each clip of a run records the detector that
 * decided it (`DetectShotsResult.detector`); a run named after one detector must hold only that detector's
 * clips: `predict:shots` writes nothing when a model run fell back, and `eval:shots` refuses such a file.
 * A stored library names no detector (the app falls back by design), so it is only counted.
 */
import type { ShotPredictions } from './schema';

export type Decider = 'model' | 'scdet';

/** The detector a run's name promises: the model for TransNetV2's runs, scdet for scdet's; none for a library. */
export function promisedDecider(detector: string): Decider | undefined {
  if (detector.startsWith('transnetv2')) return 'model';
  if (detector.startsWith('scdet')) return 'scdet';
  return undefined;
}

/** Clips another detector decided than the run's name promises, as `file (detector)`; runs before IX2-S7 record none. */
export function misattributedClips(run: ShotPredictions): string[] {
  const promised = promisedDecider(run.detector);
  if (promised === undefined) return [];
  return run.clips.flatMap((clip) =>
    clip.detector !== undefined && clip.detector !== promised ? [`${clip.file} (${clip.detector})`] : [],
  );
}

/** How many clips each detector decided, where the run recorded it. */
export function decidedBy(run: ShotPredictions): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { detector } of run.clips)
    if (detector !== undefined) counts[detector] = (counts[detector] ?? 0) + 1;
  return counts;
}
