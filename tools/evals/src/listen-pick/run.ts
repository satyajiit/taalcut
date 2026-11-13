// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Scores listen-pick: a query passes when any of its top 5 sounds is of a family the label accepts. */
import { join } from 'node:path';
import { writeJson } from '../files';
import { writeReport } from '../report';
import { familyOf } from './families';
import { renderPickMarkdown, type PickCase, type PickReport } from './report';
import {
  loadPickLabels,
  loadPickPredictions,
  type Picked,
  type PickLabel,
  type PickPrediction,
} from './schema';
import { PICK_BAR } from './threshold';

const hits = (label: PickLabel, picked: readonly Picked[]) =>
  picked.some((p) => {
    const family = familyOf(p.category, p.upstreamId);
    return family !== null && (label.families as readonly string[]).includes(family);
  });

export function scorePick(
  labels: readonly PickLabel[],
  predictions: ReadonlyMap<string, PickPrediction>,
): PickReport {
  const cases: PickCase[] = labels.map((label) => {
    const prediction = predictions.get(label.caseId);
    if (!prediction) throw new Error(`No prediction for ${label.caseId}`);
    return {
      caseId: label.caseId,
      query: label.query,
      families: [...label.families],
      hit: hits(label, prediction.top),
      audioHit: hits(label, prediction.audioTop),
      top: prediction.top.map((p) => p.soundId),
    };
  });
  const rate = cases.filter((c) => c.hit).length / Math.max(1, cases.length);
  const audioRate = cases.filter((c) => c.audioHit).length / Math.max(1, cases.length);
  const dtype = predictions.values().next().value?.dtype ?? 'fp16';
  const pass = cases.length > 0 && rate >= PICK_BAR.top5FamilyRate;
  return {
    suite: 'listen-pick',
    synthetic: false,
    claimed: true,
    gate: {
      id: 'EAR1-B2',
      pass,
      detail: `top-5 family rate ${rate.toFixed(3)} (need >= ${PICK_BAR.top5FamilyRate}; audio alone ${audioRate.toFixed(3)}; ${dtype})`,
    },
    metrics: [
      { name: 'top5FamilyRate', value: rate, better: 'higher' },
      { name: 'audioTop5FamilyRate', value: audioRate, better: 'higher' },
    ],
    cases,
  };
}

export function scorePickDirs(labelsDir: string, predictionsDir: string): PickReport {
  return scorePick(loadPickLabels(labelsDir), loadPickPredictions(predictionsDir));
}

export function writePickPredictions(predictions: readonly PickPrediction[], outDir: string): void {
  writeJson(join(outDir, 'predictions.json'), predictions);
}

export function writePickReport(report: PickReport, markdownPath: string): void {
  writeReport(markdownPath, renderPickMarkdown(report), report);
}
