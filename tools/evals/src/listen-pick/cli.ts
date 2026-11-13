// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** `fixtures:listen-pick`, `predict:listen-pick`, `eval:listen-pick` (EAR1-B2); predict needs the models and bank. */
import { type SuiteCommands, suiteEntry } from '../suite-cli';
import { writePickFixtures } from './fixtures';
import { predictPick } from './predict';
import type { PickReport } from './report';
import { scorePickDirs, writePickPredictions, writePickReport } from './run';
import { loadPickLabels, type PickPrediction } from './schema';

const commands: SuiteCommands<PickReport, PickPrediction> = {
  suite: 'listen-pick',
  notes:
    'predict needs TAALCUT_EAR1_MODELS (unpacked listen models) and a built bank (TAALCUT_SFX_BANK); ' +
    'TAALCUT_LISTEN_DTYPE=int8 for the int8 builds.',
  score: (labelsDir, predictionsDir) => scorePickDirs(labelsDir, predictionsDir),
  writeReport: (report, markdownPath) => writePickReport(report, markdownPath),
  predict: (labelsDir) => predictPick(loadPickLabels(labelsDir)),
  writePredictions: (predictions, outDir) => writePickPredictions(predictions, outDir),
  writeFixtures: (outDir) => writePickFixtures(outDir),
};

suiteEntry(import.meta.url, commands);
