// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What both routes of the analysis pass share: the analysis filters and how their output is read back.
 * FFmpeg's own decode (run-pass.ts) and the decode service (helper-pass.ts) run the same filters on the
 * same frames, so they give the same scores and intervals.
 */
import { readFile } from 'node:fs/promises';
import type { TimeInterval } from '../primitives/parsers';
import type { DetectMinimum, SceneSample } from './pass-types';
import { parseSceneFile } from './scene-file';

export const SCDET = 'scdet=threshold=0:sc_pass=1';
export const DETECT_LINES = /black_start|black_end|freeze_start|freeze_end/;

/** Each detector's minimum under `min`; one left out keeps FFmpeg's (2 s). */
export function detectMinimums(min: DetectMinimum | undefined): {
  readonly black?: number;
  readonly freeze?: number;
} {
  return typeof min === 'number' ? { black: min, freeze: min } : (min ?? {});
}

/** blackdetect and freezedetect, each with FFmpeg's minimum duration (2 s) or the one `min` gives it. */
export function detectorFilters(min: DetectMinimum | undefined): string[] {
  const { black, freeze } = detectMinimums(min);
  const filter = (name: string, seconds: number | undefined) =>
    seconds === undefined ? name : `${name}=d=${seconds}`;
  return [filter('blackdetect', black), filter('freezedetect', freeze)];
}

/** A branch's scene scores, on the whole file's grid: sample k of a branch keeping every `every`-th frame. */
export async function sceneFile(path: string, every: number, from: number): Promise<SceneSample[]> {
  const text = await readFile(path, 'utf8').catch(() => '');
  return parseSceneFile(text).map((s) => ({ index: from + s.frame * every, score: s.score, mafd: s.mafd }));
}

export const shifted = (intervals: readonly TimeInterval[], by: number): TimeInterval[] =>
  intervals.map((i) => ({ startSec: i.startSec + by, endSec: i.endSec + by }));
