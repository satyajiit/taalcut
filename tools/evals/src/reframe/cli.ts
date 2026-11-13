// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { predictReframe } from '../adapters/reframe';
import { type SuiteCommands, suiteEntry } from '../suite-cli';
import { writeReframeFixtures } from './fixtures';
import type { ReframeReport } from './report';
import { scoreReframeDirs, writeReframePredictions, writeReframeReport } from './run';
import { type ReframePrediction, loadReframeLabels } from './schema';

const commands: SuiteCommands<ReframeReport, ReframePrediction> = {
  suite: 'reframe',
  score: (labelsDir, predictionsDir) => scoreReframeDirs(labelsDir, predictionsDir),
  writeReport: (report, markdownPath) => writeReframeReport(report, markdownPath),
  predict: (labelsDir) => predictReframe(loadReframeLabels(labelsDir)),
  writePredictions: (predictions, outDir) => writeReframePredictions(predictions, outDir),
  writeFixtures: (outDir) => writeReframeFixtures(outDir),
};

suiteEntry(import.meta.url, commands);
