// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { writeJson } from '../files';
import { writeReport } from '../report';
import { CLEANUP_BARS, cleanupGatePasses, scoreCleanupCase, type CleanupCaseScore } from './metric';
import { renderCleanupMarkdown, type CleanupReport } from './report';
import {
  loadCleanupLabels,
  loadCleanupPredictions,
  type CleanupLabel,
  type CleanupPrediction,
} from './schema';

export function scoreCleanup(
  labels: readonly CleanupLabel[],
  predictions: ReadonlyMap<string, CleanupPrediction>,
): CleanupReport {
  const cases = labels.map((label) => {
    const prediction = predictions.get(label.caseId);
    if (prediction === undefined) throw new Error(`No prediction for ${label.caseId}`);
    return scoreCleanupCase(label, prediction);
  });
  const labelled = cases.reduce((total, row) => total + row.labelled, 0);
  const removed = cases.reduce((total, row) => total + row.removed, 0);
  const removedShare = labelled === 0 ? 0 : removed / labelled;
  const clippedWords = cases.reduce((total, row) => total + row.clippedWords, 0);
  const falseRemovals = cases.reduce((total, row) => total + row.falseRemovals, 0);
  const synthetic = labels.some((label) => label.synthetic);
  const pass = cases.length > 0 && cases.every((row) => cleanupGatePasses(row));
  const detail = `removedShare ${removedShare.toFixed(3)} (need >= ${CLEANUP_BARS.removedShare}); clippedWords ${clippedWords} (need ${CLEANUP_BARS.clippedWords})`;
  return {
    suite: 'cleanup',
    synthetic,
    claimed: !synthetic,
    gate: { id: 'P3-V9', pass, detail },
    metrics: [
      { name: 'removedShare', value: removedShare, better: 'higher' },
      { name: 'clippedWords', value: clippedWords, better: 'lower' },
      { name: 'falseRemovals', value: falseRemovals, better: 'lower' },
    ],
    cases,
  };
}

export function scoreCleanupDirs(labelsDir: string, predictionsDir: string): CleanupReport {
  return scoreCleanup(loadCleanupLabels(labelsDir), loadCleanupPredictions(predictionsDir));
}

export function writeCleanupPredictions(predictions: readonly CleanupPrediction[], outDir: string): void {
  writeJson(join(outDir, 'predictions.json'), predictions);
}

export function writeCleanupReport(report: CleanupReport, markdownPath: string): void {
  writeReport(markdownPath, renderCleanupMarkdown(report), report);
}

export type { CleanupCaseScore };
