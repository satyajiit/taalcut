// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { predictVoice } from '../adapters/voice';
import { type SuiteCommands, suiteEntry } from '../suite-cli';
import { writeVoiceFixtures } from './fixtures';
import type { VoiceReport } from './report';
import { scoreVoiceDirs, writeVoicePredictions, writeVoiceReport } from './run';
import { type VoicePrediction, loadVoiceLabels } from './schema';

const commands: SuiteCommands<VoiceReport, VoicePrediction> = {
  suite: 'voice',
  score: (labelsDir, predictionsDir) => scoreVoiceDirs(labelsDir, predictionsDir),
  writeReport: (report, markdownPath) => writeVoiceReport(report, markdownPath),
  predict: (labelsDir) => predictVoice(loadVoiceLabels(labelsDir)),
  writePredictions: (predictions, outDir) => writeVoicePredictions(predictions, outDir),
  writeFixtures: (outDir) => writeVoiceFixtures(outDir),
};

suiteEntry(import.meta.url, commands);
