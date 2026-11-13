// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { writeJson } from '../files';
import { writeReport } from '../report';
import { scoreVoiceCase, voiceGatePasses, type VoiceCaseScore } from './metric';
import { renderVoiceMarkdown, type VoiceReport } from './report';
import { loadVoiceLabels, loadVoicePredictions, type VoiceLabel, type VoicePrediction } from './schema';

function sum(rows: readonly VoiceCaseScore[], pick: (row: VoiceCaseScore) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

export function scoreVoice(
  labels: readonly VoiceLabel[],
  predictions: ReadonlyMap<string, VoicePrediction>,
): VoiceReport {
  const cases = labels.map((label) => {
    const prediction = predictions.get(label.caseId);
    if (prediction === undefined) throw new Error(`No prediction for ${label.caseId}`);
    return scoreVoiceCase(label, prediction);
  });
  const synthetic = labels.some((label) => label.synthetic);
  const lines = sum(cases, (row) => row.lines);
  const onBeatShare =
    lines === 0 ? 0 : cases.reduce((total, row) => total + row.onBeatShare * row.lines, 0) / lines;
  const overlaps = sum(cases, (row) => row.overlaps);
  const outside = sum(cases, (row) => row.outside);
  const pass = cases.length > 0 && cases.every((row) => voiceGatePasses(row));
  const detail = `onBeatShare ${onBeatShare.toFixed(3)} (need 1); overlaps ${overlaps} (need 0); outside ${outside} (need 0)`;
  return {
    suite: 'voice',
    synthetic,
    claimed: !synthetic,
    gate: { id: 'P3-B6', pass, detail },
    metrics: [
      { name: 'onBeatShare', value: onBeatShare, better: 'higher' },
      { name: 'overlaps', value: overlaps, better: 'lower' },
      { name: 'outside', value: outside, better: 'lower' },
    ],
    cases,
  };
}

export function scoreVoiceDirs(labelsDir: string, predictionsDir: string): VoiceReport {
  return scoreVoice(loadVoiceLabels(labelsDir), loadVoicePredictions(predictionsDir));
}

export function writeVoicePredictions(predictions: readonly VoicePrediction[], outDir: string): void {
  writeJson(join(outDir, 'predictions.json'), predictions);
}

export function writeVoiceReport(report: VoiceReport, markdownPath: string): void {
  writeReport(markdownPath, renderVoiceMarkdown(report), report);
}
