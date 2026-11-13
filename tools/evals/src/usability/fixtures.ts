// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  TASK_IDS,
  parseUsabilitySession,
  type FindingSeverity,
  type SessionLanguage,
  type TaskId,
  type TaskOutcome,
  type UsabilityFinding,
  type UsabilitySession,
} from './schema';

/**
 * Hand-computed medians, in seconds. These sessions were not run with a participant.
 *
 * One session per language: en 600, hi 900, es 1200, pt-BR 1800.
 * Overall median of those four is (900 + 1200) / 2 = 1050.
 *
 * A second English session is 1050, so the English median is (600 + 1050) / 2 = 825.
 * All five sort as 600, 900, 1050, 1200, 1800, and the overall median stays 1050.
 *
 * The first two English findings differ only by case and extra spaces, so they are one draft.
 * The third finding in this list is high severity and sorts first.
 */
export const FIXTURE_FOUR_LANGUAGE_SECONDS = [600, 900, 1200, 1800] as const;
export const FIXTURE_EN_SECONDS = [600, 1050] as const;
export const FIXTURE_OVERALL_MEDIAN_SECONDS = 1050;
export const FIXTURE_EN_MEDIAN_SECONDS = 825;
export const FIXTURE_HI_MEDIAN_SECONDS = 900;
export const FIXTURE_ES_MEDIAN_SECONDS = 1200;
export const FIXTURE_PT_BR_MEDIAN_SECONDS = 1800;

const TASK_ORIGIN_MS = Date.parse('2026-10-15T09:00:00.000Z');

export interface FixtureSessionInput {
  sessionId: string;
  language: SessionLanguage;
  timeToFirstVideoSeconds: number | null;
  cohortCode: string;
  findings?: readonly UsabilityFinding[];
  outcomes?: Partial<Record<TaskId, TaskOutcome>>;
}

function taskInstant(offsetMinutes: number): string {
  return new Date(TASK_ORIGIN_MS + offsetMinutes * 60_000).toISOString();
}

/** In-memory session with `synthetic: true`. Not a measurement from a person. */
export function buildFixtureSession(input: FixtureSessionInput): UsabilitySession {
  const tasks = TASK_IDS.map((id, index) => ({
    id,
    startedAt: taskInstant(index * 10),
    endedAt: taskInstant(index * 10 + 4),
    outcome: input.outcomes?.[id] ?? 'success',
    errors: [] as string[],
    ease: 5,
  }));
  return parseUsabilitySession({
    v: 1,
    sessionId: input.sessionId,
    language: input.language,
    date: '2026-10-15',
    moderator: 'fixture-moderator',
    mac: { chip: 'fixture-m4', memoryGb: 16 },
    participant: { cohortCode: input.cohortCode, experience: 'new to Taalcut' },
    tasks,
    timeToFirstVideoSeconds: input.timeToFirstVideoSeconds,
    findings: input.findings ?? [],
    synthetic: true,
  });
}

function finding(severity: FindingSeverity, area: string, what: string, evidence: string): UsabilityFinding {
  return { severity, area, what, evidence };
}

/** Five synthetic sessions: the four-language set, plus a second English session. */
export function fixtureSessions(): UsabilitySession[] {
  return [
    buildFixtureSession({
      sessionId: 'fixture-en-a',
      language: 'en',
      timeToFirstVideoSeconds: FIXTURE_EN_SECONDS[0],
      cohortCode: 'EN000A',
      outcomes: { T4: 'assisted' },
      findings: [
        finding(
          'medium',
          'onboarding',
          '  Onboarding   copy is dense ',
          'Pointed at the word library and stopped.',
        ),
      ],
    }),
    buildFixtureSession({
      sessionId: 'fixture-en-b',
      language: 'en',
      timeToFirstVideoSeconds: FIXTURE_EN_SECONDS[1],
      cohortCode: 'EN000B',
      findings: [
        finding('medium', 'onboarding', 'onboarding copy is dense', 'Read the import sentence twice.'),
      ],
    }),
    buildFixtureSession({
      sessionId: 'fixture-hi',
      language: 'hi',
      timeToFirstVideoSeconds: FIXTURE_HI_MEDIAN_SECONDS,
      cohortCode: 'HI0001',
      outcomes: { T5: 'failed' },
      findings: [
        finding('high', 'export', 'Export button is easy to miss', 'Looked in the menu for a minute.'),
      ],
    }),
    buildFixtureSession({
      sessionId: 'fixture-es',
      language: 'es',
      timeToFirstVideoSeconds: FIXTURE_ES_MEDIAN_SECONDS,
      cohortCode: 'ES0001',
      outcomes: { T6: 'abandoned' },
      findings: [
        finding('medium', 'reference', 'Reel link field has no example', 'Held the card up and waited.'),
      ],
    }),
    buildFixtureSession({
      sessionId: 'fixture-pt-br',
      language: 'pt-BR',
      timeToFirstVideoSeconds: FIXTURE_PT_BR_MEDIAN_SECONDS,
      cohortCode: 'NONE',
      findings: [
        finding(
          'low',
          'captions',
          'Caption style names are unclear',
          'Tried two styles before the right one.',
        ),
      ],
    }),
  ];
}

/** The one-per-language subset whose overall median is 1050. Drops the second English session. */
export function fourLanguageSessions(): UsabilitySession[] {
  return fixtureSessions().filter((session) => session.sessionId !== 'fixture-en-b');
}
