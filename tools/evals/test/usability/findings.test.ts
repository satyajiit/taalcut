// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { buildFixtureSession, fixtureSessions } from '../../src/usability/fixtures';
import { findingsMarkdown, groupFindings, normaliseWhat } from '../../src/usability/findings';

describe('usability findings', () => {
  it('groups wording that differs only by case and extra spaces', () => {
    const sessions = fixtureSessions();
    const first = sessions[0]?.findings[0]?.what;
    const second = sessions[1]?.findings[0]?.what;
    if (first === undefined || second === undefined) throw new Error('missing shared finding');
    expect(first).not.toBe(second);
    expect(normaliseWhat(first)).toBe(normaliseWhat(second));
    const grouped = groupFindings(sessions).filter((draft) => draft.what === 'Onboarding copy is dense');
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.sessions).toEqual(['fixture-en-a', 'fixture-en-b']);
    expect(grouped[0]?.evidence).toContain('Pointed at the word library and stopped.');
    expect(grouped[0]?.evidence).toContain('Read the import sentence twice.');
  });

  it('ranks high first, then more sessions within a severity, then low', () => {
    const drafts = groupFindings(fixtureSessions());
    expect(drafts.map((draft) => draft.severity)).toEqual(['high', 'medium', 'medium', 'low']);
    expect(drafts.map((draft) => draft.sessions.length)).toEqual([1, 2, 1, 1]);
    expect(drafts.map((draft) => draft.what)).toEqual([
      'Export button is easy to miss',
      'Onboarding copy is dense',
      'Reel link field has no example',
      'Caption style names are unclear',
    ]);
  });

  it('writes one draft work package per finding, with no invented id', () => {
    const markdown = findingsMarkdown(fixtureSessions());
    expect(markdown).toContain('These are drafts for the PO to file the same week.');
    expect(markdown).not.toMatch(/WP-\d/);
    const headings = markdown.split('\n').filter((line) => line.startsWith('## Draft WP:'));
    expect(headings[0]).toBe('## Draft WP: Export button is easy to miss');
    expect(markdown).toContain(
      '- Severity: high\n- Area: export\n- Evidence: Looked in the menu for a minute.\n- Sessions: fixture-hi',
    );
    expect(markdown).toContain('- Sessions: fixture-en-a, fixture-en-b');
  });

  it('says there are none when a session has no findings', () => {
    const quiet = buildFixtureSession({
      sessionId: 'fixture-quiet',
      language: 'en',
      timeToFirstVideoSeconds: 600,
      cohortCode: 'NONE',
      findings: [],
    });
    const markdown = findingsMarkdown([quiet]);
    expect(markdown).toContain('There are none.');
    expect(markdown).not.toContain('## Draft WP:');
    expect(findingsMarkdown([])).toContain('There are none.');
  });
});
