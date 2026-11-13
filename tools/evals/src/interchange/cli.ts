// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { pathChecker, predictInterchange } from '../adapters/interchange';
import { type SuiteCommands, suiteEntry } from '../suite-cli';
import { writeInterchangeFixtures } from './fixtures';
import type { InterchangeReport } from './report';
import { scoreInterchangeDirs, writeInterchangePredictions, writeInterchangeReport } from './run';
import { type InterchangePrediction, loadInterchangeLabels } from './schema';

const commands: SuiteCommands<InterchangeReport, InterchangePrediction> = {
  suite: 'interchange',
  notes: [
    '',
    'predict checks otiocat and xmllint when they are on PATH. A missing tool is recorded and does not fail the cut bar.',
    'xmllint --dtdvalid uses TAALCUT_FCPXML_DTD when that variable names the Final Cut DTD.',
  ].join('\n'),
  score: (labelsDir, predictionsDir) => scoreInterchangeDirs(labelsDir, predictionsDir),
  writeReport: (report, markdownPath) => writeInterchangeReport(report, markdownPath),
  predict: (labelsDir) => predictInterchange(loadInterchangeLabels(labelsDir), pathChecker),
  writePredictions: (predictions, outDir) => writeInterchangePredictions(predictions, outDir),
  writeFixtures: (outDir) => writeInterchangeFixtures(outDir),
};

suiteEntry(import.meta.url, commands);
