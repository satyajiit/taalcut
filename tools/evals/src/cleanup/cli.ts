// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { predictCleanup } from '../adapters/cleanup';
import { type SuiteCommands, suiteEntry } from '../suite-cli';
import { writeCleanupFixtures } from './fixtures';
import type { CleanupReport } from './report';
import { scoreCleanupDirs, writeCleanupPredictions, writeCleanupReport } from './run';
import { type CleanupPrediction, loadCleanupLabels } from './schema';

const commands: SuiteCommands<CleanupReport, CleanupPrediction> = {
  suite: 'cleanup',
  score: (labelsDir, predictionsDir) => scoreCleanupDirs(labelsDir, predictionsDir),
  writeReport: (report, markdownPath) => writeCleanupReport(report, markdownPath),
  predict: (labelsDir) => predictCleanup(loadCleanupLabels(labelsDir)),
  writePredictions: (predictions, outDir) => writeCleanupPredictions(predictions, outDir),
  writeFixtures: (outDir) => writeCleanupFixtures(outDir),
};

suiteEntry(import.meta.url, commands);
