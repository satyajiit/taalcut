// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BREAKDOWN_STEPS, type TemplateBreakdownSystem } from '../adapters/breakdown';
import { type BreakdownSystem } from '../adapters/types';
import { evaluateDirs, loadGoldenDir } from '../evaluate';
import { writeJson } from '../files';
import { type EvalReport } from '../metric';
import { parsePredictionReel } from '../schema';

export async function predictBreakdown(
  system: BreakdownSystem,
  goldenDir: string,
  outDir: string,
): Promise<void> {
  const reels = loadGoldenDir(goldenDir);
  mkdirSync(outDir, { recursive: true });
  for (const reel of reels) {
    const cuts = await system.predictCuts({
      reelId: reel.reelId,
      ...(reel.source.uri === undefined ? {} : { mediaPath: reel.source.uri }),
      frameRate: reel.frameRate,
      durationFrames: reel.source.durationFrames,
    });
    const prediction = parsePredictionReel({ reelId: reel.reelId, cuts });
    writeJson(join(outDir, `${prediction.reelId}.json`), prediction);
  }
}

/**
 * Each method's cuts as their own predictions, `<outDir>/<step>/<reelId>.json`, so every step scores
 * with the same scorer: confirmed by both methods, every proposal, and after the verdicts or rule.
 */
export function writeBreakdownSteps(system: TemplateBreakdownSystem, outDir: string): string[] {
  for (const step of BREAKDOWN_STEPS) {
    for (const [reelId, steps] of system.steps) {
      writeJson(join(outDir, step, `${reelId}.json`), parsePredictionReel({ reelId, cuts: steps[step] }));
    }
  }
  return BREAKDOWN_STEPS.map((step) => join(outDir, step));
}

export function scoreBreakdown(goldenDir: string, predictionsDir: string): EvalReport {
  return evaluateDirs(goldenDir, predictionsDir);
}
