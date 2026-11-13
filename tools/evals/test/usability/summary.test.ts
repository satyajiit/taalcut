// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  buildFixtureSession,
  FIXTURE_EN_MEDIAN_SECONDS,
  FIXTURE_EN_SECONDS,
  FIXTURE_ES_MEDIAN_SECONDS,
  FIXTURE_FOUR_LANGUAGE_SECONDS,
  FIXTURE_HI_MEDIAN_SECONDS,
  FIXTURE_OVERALL_MEDIAN_SECONDS,
  FIXTURE_PT_BR_MEDIAN_SECONDS,
  fixtureSessions,
  fourLanguageSessions,
} from '../../src/usability/fixtures';
import { displayMedian, summarise, summaryMarkdown } from '../../src/usability/summary';

describe('usability summary medians', () => {
  it('takes the overall median of one session per language as 1050', () => {
    // 600, 900, 1200, 1800. Even count: (900 + 1200) / 2 = 1050.
    expect(FIXTURE_FOUR_LANGUAGE_SECONDS).toEqual([600, 900, 1200, 1800]);
    expect(FIXTURE_OVERALL_MEDIAN_SECONDS).toBe(1050);
    const summary = summarise(fourLanguageSessions());
    expect(summary.timeToFirstVideoSeconds.overall).toBe(1050);
    expect(summary.timeToFirstVideoSeconds.byLanguage).toEqual({
      en: 600,
      hi: 900,
      es: 1200,
      'pt-BR': 1800,
    });
  });

  it('averages the two English times and keeps the five-session overall median at 1050', () => {
    // English: (600 + 1050) / 2 = 825. Five values: 600, 900, 1050, 1200, 1800. Middle is 1050.
    expect(FIXTURE_EN_SECONDS).toEqual([600, 1050]);
    expect(FIXTURE_EN_MEDIAN_SECONDS).toBe(825);
    expect(FIXTURE_HI_MEDIAN_SECONDS).toBe(900);
    expect(FIXTURE_ES_MEDIAN_SECONDS).toBe(1200);
    expect(FIXTURE_PT_BR_MEDIAN_SECONDS).toBe(1800);
    const summary = summarise(fixtureSessions());
    expect(summary.sessionCount).toBe(5);
    expect(summary.timeToFirstVideoSeconds.overall).toBe(1050);
    expect(summary.timeToFirstVideoSeconds.byLanguage.en).toBe(825);
    expect(summary.timeToFirstVideoSeconds.byLanguage.hi).toBe(900);
    expect(summary.timeToFirstVideoSeconds.byLanguage.es).toBe(1200);
    expect(summary.timeToFirstVideoSeconds.byLanguage['pt-BR']).toBe(1800);
  });

  it('reports a language with no session as null and no data', () => {
    const english = fixtureSessions().filter((session) => session.language === 'en');
    const summary = summarise(english);
    expect(summary.timeToFirstVideoSeconds.byLanguage.en).toBe(825);
    expect(summary.timeToFirstVideoSeconds.byLanguage.hi).toBeNull();
    expect(summary.timeToFirstVideoSeconds.byLanguage.es).toBeNull();
    expect(summary.timeToFirstVideoSeconds.byLanguage['pt-BR']).toBeNull();
    expect(displayMedian(null)).toBe('no data');
    expect(displayMedian(summary.timeToFirstVideoSeconds.byLanguage.hi)).toBe('no data');
    expect(displayMedian(1050)).toBe('1050');
    expect(summaryMarkdown(summary)).toContain('| hi | no data |');
    expect(summaryMarkdown(summary)).toContain('| en | 825 |');
  });

  it('counts a session with no export after every exporter, so the median can be not reached', () => {
    const noExport = (sessionId: string, language: 'en' | 'hi') =>
      buildFixtureSession({ sessionId, language, timeToFirstVideoSeconds: null, cohortCode: 'NONE' });
    // Overall: 600, 900, 1050, 1200, 1800, none. Even count: (1050 + 1200) / 2 = 1125, not the 1050 of exporters only.
    const one = summarise([...fixtureSessions(), noExport('fixture-no-export', 'hi')]);
    expect(one.timeToFirstVideoSeconds.overall).toBe(1125);
    expect(one.timeToFirstVideoSeconds.noExport.overall).toBe(1);
    expect(one.timeToFirstVideoSeconds.noExport.hi).toBe(1);
    // Hindi: 900 and none. The upper middle never exported: not reached, and not 900.
    expect(one.timeToFirstVideoSeconds.byLanguage.hi).toBeNull();
    expect(one.timeToFirstVideoSeconds.notReached).toEqual(['hi']);
    expect(summaryMarkdown(one)).toContain('| hi | not reached | 1 |');
    // The session still counts in task success and findings.
    expect(one.sessionCount).toBe(6);
    expect(one.tasks[0]?.n).toBe(6);

    const many = summarise([
      ...fourLanguageSessions(),
      noExport('fixture-none-a', 'en'),
      noExport('fixture-none-b', 'en'),
      noExport('fixture-none-c', 'hi'),
      noExport('fixture-none-d', 'hi'),
    ]);
    expect(many.timeToFirstVideoSeconds.overall).toBeNull();
    expect(many.timeToFirstVideoSeconds.notReached).toContain('overall');
    expect(summaryMarkdown(many)).toContain('| Overall | not reached | 4 |');
  });

  it('says a summary of fixtures is synthetic', () => {
    const summary = summarise(fixtureSessions());
    expect(summary.synthetic).toBe(true);
    expect(summaryMarkdown(summary)).toContain('Synthetic: generated fixture sessions');
    const real = fixtureSessions().map((session) => ({ ...session, synthetic: false }));
    expect(summarise(real).synthetic).toBe(false);
    expect(summaryMarkdown(summarise(real))).not.toContain('Synthetic');
  });

  it('does not count assisted, failed, or abandoned as success', () => {
    const summary = summarise(fixtureSessions());
    const byId = new Map(summary.tasks.map((task) => [task.id, task]));
    expect(byId.get('T1')).toMatchObject({
      success: 5,
      assisted: 0,
      failed: 0,
      abandoned: 0,
      n: 5,
      successRate: 1,
    });
    expect(byId.get('T4')).toMatchObject({
      success: 4,
      assisted: 1,
      failed: 0,
      abandoned: 0,
      n: 5,
      successRate: 0.8,
    });
    expect(byId.get('T5')).toMatchObject({
      success: 4,
      assisted: 0,
      failed: 1,
      abandoned: 0,
      n: 5,
      successRate: 0.8,
    });
    expect(byId.get('T6')).toMatchObject({
      success: 4,
      assisted: 0,
      failed: 0,
      abandoned: 1,
      n: 5,
      successRate: 0.8,
    });
  });

  it('does not invent successes or zero medians for an empty list', () => {
    const summary = summarise([]);
    expect(summary.sessionCount).toBe(0);
    expect(summary.timeToFirstVideoSeconds.overall).toBeNull();
    expect(summary.timeToFirstVideoSeconds.byLanguage).toEqual({
      en: null,
      hi: null,
      es: null,
      'pt-BR': null,
    });
    expect(summary.tasks.map((task) => task.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
    for (const task of summary.tasks) {
      expect(task.success).toBe(0);
      expect(task.assisted).toBe(0);
      expect(task.failed).toBe(0);
      expect(task.abandoned).toBe(0);
      expect(task.n).toBe(0);
      expect(task.successRate).toBeNull();
    }
    const markdown = summaryMarkdown(summary);
    expect(markdown).toContain('No sessions loaded');
    expect(markdown).toContain('| Overall | no data |');
    expect(markdown).toContain('| T1 | 0 | 0 | 0 | 0 | 0 | no data |');
  });
});
