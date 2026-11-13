// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { censoredMedian } from '../gates/stats';
import { LANGUAGES, TASK_IDS, type SessionLanguage, type TaskId, type UsabilitySession } from './schema';

export type MedianScope = 'overall' | SessionLanguage;

/**
 * Every session counts, including those with no export. A session with no export sorts after every exporter, so
 * when it sits in the middle the median is `not reached`, never a number and never a stand-in zero.
 */
export interface TimeToFirstVideoSummary {
  /** Null when there are no sessions, or when the median was not reached (see `notReached`). */
  overall: number | null;
  /** Every v1 language is present. A language with no session is null, not 0. */
  byLanguage: Record<SessionLanguage, number | null>;
  /** Sessions in each scope that ended with no export. */
  noExport: Record<MedianScope, number>;
  /** Scopes whose median participant never exported. */
  notReached: MedianScope[];
}

export interface TaskSuccess {
  id: TaskId;
  success: number;
  assisted: number;
  failed: number;
  abandoned: number;
  /** Sessions that recorded this task. */
  n: number;
  /** `success / n`. Assisted is not success. Null when n is 0. */
  successRate: number | null;
}

export interface UsabilitySummary {
  sessionCount: number;
  /** True when any loaded session is a generated fixture. Such a summary is not a measurement. */
  synthetic: boolean;
  timeToFirstVideoSeconds: TimeToFirstVideoSummary;
  /**
   * The six protocol tasks, always, in order. Counts stay zero when nothing was loaded,
   * so an empty directory is not a perfect score.
   */
  tasks: TaskSuccess[];
}

/** What a moderator or the summary markdown shows for a missing median. */
export function displayMedian(medianSeconds: number | null, notReached = false): string {
  if (notReached) return 'not reached';
  return medianSeconds === null ? 'no data' : String(medianSeconds);
}

function displayRate(rate: number | null): string {
  return rate === null ? 'no data' : String(rate);
}

function blankTask(id: TaskId): TaskSuccess {
  return { id, success: 0, assisted: 0, failed: 0, abandoned: 0, n: 0, successRate: null };
}

function timesByScope(sessions: readonly UsabilitySession[]): Record<MedianScope, (number | null)[]> {
  const buckets: Record<MedianScope, (number | null)[]> = {
    overall: [],
    en: [],
    hi: [],
    es: [],
    'pt-BR': [],
  };
  for (const session of sessions) {
    buckets.overall.push(session.timeToFirstVideoSeconds);
    buckets[session.language].push(session.timeToFirstVideoSeconds);
  }
  return buckets;
}

function timeToFirstVideo(sessions: readonly UsabilitySession[]): TimeToFirstVideoSummary {
  const buckets = timesByScope(sessions);
  const notReached: MedianScope[] = [];
  const medianOf = (scope: MedianScope): number | null => {
    const value = censoredMedian(buckets[scope]);
    if (value !== 'not reached') return value;
    notReached.push(scope);
    return null;
  };
  const missing = (scope: MedianScope): number => buckets[scope].filter((value) => value === null).length;
  return {
    overall: medianOf('overall'),
    byLanguage: { en: medianOf('en'), hi: medianOf('hi'), es: medianOf('es'), 'pt-BR': medianOf('pt-BR') },
    noExport: {
      overall: missing('overall'),
      en: missing('en'),
      hi: missing('hi'),
      es: missing('es'),
      'pt-BR': missing('pt-BR'),
    },
    notReached,
  };
}

function taskRows(sessions: readonly UsabilitySession[]): TaskSuccess[] {
  const rows = new Map<TaskId, TaskSuccess>(TASK_IDS.map((id) => [id, blankTask(id)]));
  for (const session of sessions) {
    for (const task of session.tasks) {
      const row = rows.get(task.id);
      if (row === undefined) continue;
      row[task.outcome] += 1;
      row.n += 1;
    }
  }
  for (const row of rows.values()) {
    row.successRate = row.n === 0 ? null : row.success / row.n;
  }
  return TASK_IDS.map((id) => rows.get(id) ?? blankTask(id));
}

export function summarise(sessions: readonly UsabilitySession[]): UsabilitySummary {
  return {
    sessionCount: sessions.length,
    synthetic: sessions.some((session) => session.synthetic),
    timeToFirstVideoSeconds: timeToFirstVideo(sessions),
    tasks: taskRows(sessions),
  };
}

export const SYNTHETIC_NOTE = 'Synthetic: generated fixture sessions, not a measurement from a person.';

export function summaryMarkdown(summary: UsabilitySummary): string {
  const lead =
    summary.sessionCount === 0
      ? 'No sessions loaded. There is no data, and medians are not zero.'
      : `${summary.sessionCount} session${summary.sessionCount === 1 ? '' : 's'}.`;
  const medians = summary.timeToFirstVideoSeconds;
  const cell = (scope: MedianScope, value: number | null): string =>
    `${displayMedian(value, medians.notReached.includes(scope))} | ${medians.noExport[scope]}`;
  const medianRows = [
    `| Overall | ${cell('overall', medians.overall)} |`,
    ...LANGUAGES.map((language) => `| ${language} | ${cell(language, medians.byLanguage[language])} |`),
  ];
  const taskTable = summary.tasks.map(
    (task) =>
      `| ${task.id} | ${task.success} | ${task.assisted} | ${task.failed} | ${task.abandoned} | ${task.n} | ${displayRate(task.successRate)} |`,
  );
  return [
    '# Usability summary',
    '',
    ...(summary.synthetic ? [SYNTHETIC_NOTE, ''] : []),
    lead,
    '',
    '## Time to first video (seconds)',
    '',
    'Median over every session. An even count is the average of the two middle values. A session with no export sorts after every exporter; when it is the middle one the median is `not reached`. A language with no session is `no data`, not zero.',
    '',
    '| Scope | Median | No export |',
    '| --- | --- | --- |',
    ...medianRows,
    '',
    '## Task success',
    '',
    'Success rate is success divided by n. Assisted is not success.',
    '',
    '| Task | Success | Assisted | Failed | Abandoned | n | Success rate |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...taskTable,
    '',
  ].join('\n');
}
