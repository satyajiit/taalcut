// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { predictVariants } from '../adapters/variants';
import { type SuiteCommands, suiteEntry } from '../suite-cli';
import { writeVariantFixtures } from './fixtures';
import type { VariantsReport } from './report';
import { scoreVariantDirs, writeVariantPredictions, writeVariantsReport } from './run';
import { type VariantPrediction, loadVariantLabels } from './schema';

const commands: SuiteCommands<VariantsReport, VariantPrediction> = {
  suite: 'variants',
  score: (labelsDir, predictionsDir) => scoreVariantDirs(labelsDir, predictionsDir),
  writeReport: (report, markdownPath) => writeVariantsReport(report, markdownPath),
  predict: (labelsDir) => predictVariants(loadVariantLabels(labelsDir)),
  writePredictions: (predictions, outDir) => writeVariantPredictions(predictions, outDir),
  writeFixtures: (outDir) => writeVariantFixtures(outDir),
};

suiteEntry(import.meta.url, commands);
