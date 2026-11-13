// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreAll, type EvalReport } from './metric';
import { parseGoldenReel, parsePredictionReel, type GoldenReel, type PredictionReel } from './schema';

function readJson(path: string): unknown {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not JSON: ${message}`, { cause: error });
  }
}

export function loadGoldenDir(dir: string): GoldenReel[] {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read golden dir ${dir}: ${message}`, { cause: error });
  }
  if (names.length === 0) throw new Error(`No golden reels (*.json) in ${dir}`);
  return names.map((name) => {
    const reel = parseGoldenReel(readJson(join(dir, name)), name);
    const expected = `${reel.reelId}.json`;
    if (name !== expected) throw new Error(`Golden file ${name} must be named ${expected}`);
    return reel;
  });
}

export function loadPrediction(dir: string, reelId: string): PredictionReel {
  const path = join(dir, `${reelId}.json`);
  let raw: unknown;
  try {
    raw = readJson(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`No prediction for reel ${reelId}. Expected ${path}`, { cause: error });
    }
    throw error;
  }
  const prediction = parsePredictionReel(raw, path);
  if (prediction.reelId !== reelId) {
    throw new Error(`${path} declares reelId ${prediction.reelId}, expected ${reelId}`);
  }
  return prediction;
}

export function evaluateDirs(goldenDir: string, predictionsDir: string): EvalReport {
  const reels = loadGoldenDir(goldenDir);
  return scoreAll(reels.map((reel) => ({ reel, prediction: loadPrediction(predictionsDir, reel.reelId) })));
}
