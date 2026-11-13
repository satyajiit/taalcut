// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { writeJson } from '../files';
import { writeReport } from '../report';
import {
  interchangeGatePasses,
  INTERCHANGE_BARS,
  scoreInterchangeCase,
  type InterchangeCaseScore,
} from './metric';
import { renderInterchangeMarkdown, type InterchangeReport } from './report';
import {
  loadInterchangeLabels,
  loadInterchangePredictions,
  type InterchangeLabel,
  type InterchangePrediction,
} from './schema';

export function scoreInterchange(
  labels: readonly InterchangeLabel[],
  predictions: ReadonlyMap<string, InterchangePrediction>,
): InterchangeReport {
  const cases = labels.map((label) => {
    const prediction = predictions.get(label.caseId);
    if (prediction === undefined) throw new Error(`No prediction for ${label.caseId}`);
    return scoreInterchangeCase(prediction);
  });
  const maxCutDeltaFrames = cases.reduce((max, row) => Math.max(max, row.maxCutDeltaFrames), 0);
  const synthetic = labels.some((label) => label.synthetic);
  const pass = cases.length > 0 && cases.every((row) => interchangeGatePasses(row));
  const rejected = cases.flatMap((row) => row.formats.filter((format) => format.externalStatus === 'failed'));
  const detail =
    `maxCutDeltaFrames ${maxCutDeltaFrames} (need ${INTERCHANGE_BARS.maxCutDeltaFrames}); ` +
    `files an external checker rejected ${rejected.length} (need 0)`;
  return {
    suite: 'interchange',
    synthetic,
    claimed: !synthetic,
    gate: { id: 'P3-V5', pass, detail },
    metrics: [{ name: 'maxCutDeltaFrames', value: maxCutDeltaFrames, better: 'lower' }],
    cases,
  };
}

export function scoreInterchangeDirs(labelsDir: string, predictionsDir: string): InterchangeReport {
  return scoreInterchange(loadInterchangeLabels(labelsDir), loadInterchangePredictions(predictionsDir));
}

export function writeInterchangePredictions(
  predictions: readonly InterchangePrediction[],
  outDir: string,
): void {
  writeJson(join(outDir, 'predictions.json'), predictions);
}

export function writeInterchangeReport(report: InterchangeReport, markdownPath: string): void {
  writeReport(markdownPath, renderInterchangeMarkdown(report), report);
}

export type { InterchangeCaseScore };
