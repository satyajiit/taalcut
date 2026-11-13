// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { writeJson, writeText } from '../../files';
import { buildFixtureSession } from '../../usability/fixtures';
import { COHORT_CODE, GROUND, type FixtureNumbers } from './ground';

const SESSION_LANGUAGES = ['en', 'hi', 'es', 'pt-BR'] as const;

function sessions(seconds: number, synthetic: boolean) {
  return Array.from({ length: GROUND.sessions }, (_, index) => {
    const language = SESSION_LANGUAGES[index % SESSION_LANGUAGES.length] ?? 'en';
    const built = buildFixtureSession({
      sessionId: `session-${index + 1}`,
      language,
      timeToFirstVideoSeconds: seconds,
      cohortCode: 'NONE',
      findings: [{ severity: 'low', area: 'onboarding', what: 'Copy is dense', evidence: 'session notes' }],
    });
    return { ...built, synthetic };
  });
}

interface PerfReading {
  runner: { id: string; memoryGb: number };
  metric: string;
  unit: string;
  value: number;
  better: 'lower' | 'higher';
}

function perfLine({ runner, metric, unit, value, better }: PerfReading, synthetic: boolean): string {
  return JSON.stringify({
    v: 1,
    suite: 'perf',
    metric,
    unit,
    value,
    better,
    runner: { id: runner.id, chip: 'M1', memoryGb: runner.memoryGb, macos: '15' },
    commit: 'fixture',
    date: '2027-01-20',
    synthetic,
    footage: 'device-lab',
    build: { flavour: 'beta', version: '0.9.0' },
  });
}

function manualRows(numbers: FixtureNumbers) {
  const specs = [
    { gate: 'beta' as const, row: 9 },
    { gate: 'beta' as const, row: 10 },
    { gate: 'beta' as const, row: 11 },
    { gate: 'beta' as const, row: 12 },
    { gate: 'v1' as const, row: 4 },
    { gate: 'v1' as const, row: 5 },
    { gate: 'v1' as const, row: 6 },
    { gate: 'v1' as const, row: 8 },
    { gate: 'v1' as const, row: 9 },
  ];
  return specs.map((spec) => ({
    ...spec,
    pass: !numbers.manualFailRows.includes(spec.row),
    signedBy: 'po',
    at: '2027-01-20T00:00:00.000Z',
    evidence: `notes/row-${spec.row}`,
  }));
}

export function writeCohortFile(path: string): void {
  writeJson(path, {
    [COHORT_CODE.freshBeta]: 'fresh-beta',
    [COHORT_CODE.beta]: 'beta',
    [COHORT_CODE.alpha]: 'alpha',
  });
}

function searchLanguage(language: 'overall' | 'en' | 'hi' | 'es' | 'pt-BR', queries: number, hit: number) {
  return { language, queries, hitAt5: hit, precisionAt5: hit, reciprocalRank: hit, ndcgAt5: hit };
}

function writeEvalReports(root: string, numbers: FixtureNumbers, synthetic: boolean): void {
  const { passHit, queries, overallQueries } = GROUND.search;
  writeJson(join(root, 'evals', 'search', 'report.json'), {
    suite: 'search',
    synthetic,
    claimed: true,
    gate: { id: '11', pass: numbers.ciPass, detail: 'fixture' },
    metrics: [{ name: 'hitAt5', value: passHit, better: 'higher' }],
    languages: [
      searchLanguage('overall', overallQueries, passHit),
      searchLanguage('en', queries, numbers.searchEn),
      searchLanguage('hi', queries, passHit),
      searchLanguage('es', queries, passHit),
      searchLanguage('pt-BR', queries, passHit),
    ],
  });

  writeJson(join(root, 'evals', 'breakdown', 'report.json'), {
    synthetic,
    toleranceFrames: 2,
    bar: 0.9,
    aggregate: {
      reelCount: GROUND.breakdown.reels,
      reelsMeetingBar: numbers.cleanReels,
      withinToleranceShare: numbers.cleanReels / GROUND.breakdown.reels,
    },
    reels: Array.from({ length: GROUND.breakdown.reels }, (_, index) => ({
      reelId: `reel-${index}`,
      missedTruths: index < numbers.cleanReels ? [] : [1],
      meetsBar: index < numbers.cleanReels,
    })),
  });

  const suiteReport = (suite: string, id: string, metric: string, value: number) =>
    writeJson(join(root, 'evals', suite, 'report.json'), {
      suite,
      synthetic,
      claimed: true,
      gate: { id, pass: numbers.ciPass, detail: 'fixture' },
      metrics: [{ name: metric, value, better: 'higher' }],
    });
  suiteReport('casting', '2', 'pickAcceptance', numbers.casting);
  suiteReport('render', '5', 'qaFirstPass', numbers.renderQa);
}

function nightlyLines(numbers: FixtureNumbers, synthetic: boolean): string[] {
  const { small, large } = GROUND.perf;
  const readings: PerfReading[] = [
    ...[small, large].flatMap((runner): PerfReading[] => [
      { runner, metric: 'cold-start', unit: 'seconds', value: numbers.coldStart, better: 'lower' },
      { runner, metric: 'preview-fps', unit: 'fps', value: GROUND.perf.previewFps, better: 'higher' },
    ]),
    { runner: small, metric: 'render-60s', unit: 'seconds', value: GROUND.perf.renderSeconds, better: 'lower' },
    { runner: large, metric: 'index-1h', unit: 'minutes', value: GROUND.perf.indexMinutes, better: 'lower' },
  ];
  return readings.map((reading) => perfLine(reading, synthetic));
}

function writeCiDocuments(root: string, numbers: FixtureNumbers, synthetic: boolean): void {
  const { release, channel, sessions: crashSessions } = GROUND.crash;
  writeJson(join(root, 'crashes.json'), {
    synthetic,
    rows: [{ release, channel, sessions: crashSessions, crashedSessions: numbers.crashed }],
  });
  for (const id of ['updateAndRollback', 'languages', 'accessibility']) {
    writeJson(join(root, 'ci', `${id}.json`), { id, pass: numbers.ciPass, synthetic, detail: `${id} fixture` });
  }
  writeText(join(root, 'ci', 'nightly.jsonl'), nightlyLines(numbers, synthetic).join('\n'));
}

/** Every document but the telemetry. `synthetic` is written into each one, so no generated input reads as real. */
export function writeDocuments(root: string, numbers: FixtureNumbers, synthetic: boolean): void {
  for (const record of sessions(numbers.minutes * 60, synthetic)) {
    writeJson(join(root, 'sessions', `${record.sessionId}.json`), record);
  }
  writeEvalReports(root, numbers, synthetic);
  writeCiDocuments(root, numbers, synthetic);
  writeJson(join(root, 'manual.json'), { synthetic, rows: manualRows(numbers) });
  writeCohortFile(join(root, 'cohorts.json'));
}
