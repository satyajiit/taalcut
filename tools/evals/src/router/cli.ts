// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { predictRouterDir } from '../adapters/router';
import { type SuiteCommands, suiteEntry } from '../suite-cli';
import { writeRouterFixtures } from './fixtures';
import type { RouterEvalReport } from './report';
import { scoreRouterDirs, writeRouterPredictions, writeRouterReport } from './run';
import type { RouterPrediction } from './schema';

const commands: SuiteCommands<RouterEvalReport, RouterPrediction> = {
  suite: 'router',
  notes: '\nLabels are golden.json plus logs/*.json (event arrays). golden.json is not a log.',
  score: (labelsDir, predictionsDir) => scoreRouterDirs(labelsDir, predictionsDir),
  writeReport: (report, markdownPath) => writeRouterReport(report, markdownPath),
  predict: (labelsDir) => predictRouterDir(labelsDir),
  writePredictions: (predictions, outDir) => writeRouterPredictions(predictions, outDir),
  writeFixtures: (outDir) => writeRouterFixtures(outDir),
};

suiteEntry(import.meta.url, commands);
