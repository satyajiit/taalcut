// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { writeJson } from '../files';
import { writeReport } from '../report';
import {
  REFRAME_BARS,
  reframeGatePasses,
  scoreReframeClip,
  subjectInFrameOf,
  type ReframeClipScore,
} from './metric';
import { renderReframeMarkdown, type ReframeReport } from './report';
import {
  loadReframeLabels,
  loadReframePredictions,
  type ReframeClipLabel,
  type ReframePrediction,
} from './schema';

export function scoreReframe(
  labels: readonly ReframeClipLabel[],
  predictions: ReadonlyMap<string, ReframePrediction>,
): ReframeReport {
  const clips: ReframeClipScore[] = labels.map((label) => {
    const prediction = predictions.get(label.clipId);
    if (prediction === undefined) throw new Error(`No prediction for ${label.clipId}`);
    return scoreReframeClip(label, prediction);
  });
  const subjectInFrame = subjectInFrameOf(clips);
  const jitterFrames = clips.reduce((sum, clip) => sum + clip.jitterFrames, 0);
  const fallbackFrames = clips.reduce((sum, clip) => sum + clip.fallbackFrames, 0);
  const fallbackMissed = clips.filter((clip) => clip.fallbackMissed).length;
  const synthetic = labels.some((label) => label.synthetic);
  const shown = subjectInFrame === null ? 'no subject frames' : subjectInFrame.toFixed(3);
  const detail =
    `subjectInFrame ${shown} (need ${REFRAME_BARS.subjectInFrame}); ` +
    `jitterFrames ${jitterFrames} (need ${REFRAME_BARS.jitterFrames}); ` +
    `subjectless clips framed as a subject ${fallbackMissed} (need 0)`;
  return {
    suite: 'reframe',
    synthetic,
    claimed: !synthetic,
    gate: { id: 'P3-V2', pass: reframeGatePasses(subjectInFrame, jitterFrames, fallbackMissed), detail },
    metrics: [
      ...(subjectInFrame === null
        ? []
        : [{ name: 'subjectInFrame', value: subjectInFrame, better: 'higher' as const }]),
      { name: 'jitterFrames', value: jitterFrames, better: 'lower' },
      { name: 'fallbackFrames', value: fallbackFrames, better: 'lower' },
      { name: 'fallbackMissed', value: fallbackMissed, better: 'lower' },
    ],
    clips,
  };
}

export function scoreReframeDirs(labelsDir: string, predictionsDir: string): ReframeReport {
  return scoreReframe(loadReframeLabels(labelsDir), loadReframePredictions(predictionsDir));
}

export function writeReframePredictions(predictions: readonly ReframePrediction[], outDir: string): void {
  writeJson(join(outDir, 'predictions.json'), predictions);
}

export function writeReframeReport(report: ReframeReport, markdownPath: string): void {
  writeReport(markdownPath, renderReframeMarkdown(report), report);
}
