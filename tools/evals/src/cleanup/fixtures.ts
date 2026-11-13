// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Eight fillers and two long pauses, each between kept words and clear of the 40 ms pad.
 * Nothing here calls the analyser or Silero.
 */
import { join } from 'node:path';
import { writeJson } from '../files';
import type { CleanupLabel, FrameRange } from './schema';

export const CLEANUP_CASE_ID = 'talking';

export function cleanupLabel(): CleanupLabel {
  const words: FrameRange[] = [];
  const fillers: FrameRange[] = [];
  let frame = 0;
  for (let index = 0; index < 9; index += 1) {
    words.push({ start: frame, end: frame + 8 });
    frame += 20;
    if (index < 8) {
      fillers.push({ start: frame, end: frame + 10 });
      frame += 20;
    }
  }
  const pauses: FrameRange[] = [
    { start: frame + 12, end: frame + 72 },
    { start: frame + 110, end: frame + 170 },
  ];
  words.push({ start: frame + 90, end: frame + 98 }, { start: frame + 190, end: frame + 198 });
  return {
    caseId: CLEANUP_CASE_ID,
    synthetic: true,
    fps: 30,
    clipFrames: frame + 220,
    fillers,
    pauses,
    words,
  };
}

export function writeCleanupFixtures(dir: string): { labels: string } {
  writeJson(join(dir, 'cases.json'), [cleanupLabel()]);
  return { labels: dir };
}
