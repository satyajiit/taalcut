// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { type TelemetryEnvelope } from '@taalcut/core';
import { writeJson, writeText } from '../files';
import { writeCohortFile, writeDocuments } from './fixtures/documents';
import { buildTelemetry } from './fixtures/population';
import { FIXTURE_FROM, FIXTURE_TO, numbersFor, type FixtureCase } from './fixtures/ground';

export {
  COHORT_CODE,
  DAY_MS,
  FIXTURE_FROM,
  FIXTURE_TO,
  GROUND,
  MINUTE_MS,
  T0,
  numbersFor,
  type FixtureCase,
  type FixtureNumbers,
} from './fixtures/ground';
export {
  costRecorded,
  exportCompleted,
  feedbackSent,
  onboardingFirstExport,
  onboardingStep,
  qaResult,
  renderFinished,
  sessionStarted,
  type EventSeed,
} from './fixtures/events';
export { writeCohortFile };

export function writeTelemetry(
  dir: string,
  envelopes: readonly TelemetryEnvelope[],
  synthetic = false,
): void {
  writeText(join(dir, 'events.ndjson'), envelopes.map((envelope) => JSON.stringify(envelope)).join('\n'));
  if (synthetic) writeJson(join(dir, 'synthetic.json'), { synthetic: true });
}

/**
 * Generated inputs say `synthetic: true` in every file, so a dashboard built from them is never read as a gate
 * result. Only tests that check the real-input path pass `marked: false`; the `synthetic` case is always marked.
 */
export function writeGateFixtures(
  outDir: string,
  fixtureCase: 'all' | FixtureCase = 'all',
  marked = true,
): void {
  const cases: FixtureCase[] = fixtureCase === 'all' ? ['pass', 'fail', 'synthetic'] : [fixtureCase];
  for (const name of cases) {
    const root = fixtureCase === 'all' ? join(outDir, name) : outDir;
    const numbers = numbersFor(name);
    const synthetic = marked || name === 'synthetic';
    writeTelemetry(join(root, 'telemetry'), buildTelemetry(numbers), synthetic);
    writeDocuments(root, numbers, synthetic);
  }
}

export const FIXTURE_WINDOW = { from: FIXTURE_FROM, to: FIXTURE_TO };
