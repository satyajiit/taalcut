// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureSessions } from '../../src/usability/fixtures';
import { main } from '../../src/usability/cli';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function workspace(): { sessions: string; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-usability-'));
  roots.push(root);
  const sessions = join(root, 'sessions');
  const out = join(root, 'out');
  mkdirSync(sessions);
  return { sessions, out };
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('usability summary command', () => {
  it('summarises an empty directory without inventing results', () => {
    const { sessions, out } = workspace();
    expect(main(['summary', '--sessions', sessions, '--out', out])).toBe(0);
    const summary = JSON.parse(read(join(out, 'summary.json'))) as unknown;
    expect(summary).toMatchObject({
      sessionCount: 0,
      timeToFirstVideoSeconds: {
        overall: null,
        byLanguage: { en: null, hi: null, es: null, 'pt-BR': null },
      },
    });
    expect(summary).toMatchObject({
      tasks: [
        { id: 'T1', success: 0, assisted: 0, failed: 0, abandoned: 0, n: 0, successRate: null },
        { id: 'T2', success: 0, n: 0, successRate: null },
        { id: 'T3', success: 0, n: 0, successRate: null },
        { id: 'T4', success: 0, n: 0, successRate: null },
        { id: 'T5', success: 0, n: 0, successRate: null },
        { id: 'T6', success: 0, n: 0, successRate: null },
      ],
    });
    expect(read(join(out, 'summary.md'))).toContain('| Overall | no data |');
    const findings = read(join(out, 'findings.md'));
    expect(findings).toContain('There are none.');
    expect(findings).not.toContain('## Draft WP:');
  });

  it('accepts the pnpm -- separator', () => {
    const { sessions, out } = workspace();
    expect(main(['--', 'summary', '--sessions', sessions, '--out', out])).toBe(0);
    expect(read(join(out, 'findings.md'))).toContain('There are none.');
  });

  it('writes the fixture median and the ranked drafts', () => {
    const { sessions, out } = workspace();
    for (const session of fixtureSessions()) {
      writeFileSync(
        join(sessions, `fixture-${session.sessionId}.json`),
        `${JSON.stringify(session, null, 2)}\n`,
      );
    }
    expect(main(['summary', '--sessions', sessions, '--out', out])).toBe(0);
    const summary = JSON.parse(read(join(out, 'summary.json'))) as {
      timeToFirstVideoSeconds: { overall: number };
    };
    expect(summary.timeToFirstVideoSeconds.overall).toBe(1050);
    const findings = read(join(out, 'findings.md'));
    const headings = findings.split('\n').filter((line) => line.startsWith('## Draft WP:'));
    expect(headings[0]).toBe('## Draft WP: Export button is easy to miss');
    expect(findings).toContain('- Sessions: fixture-en-a, fixture-en-b');
  });

  it('refuses a directory with a session the schema rejects', () => {
    const { sessions, out } = workspace();
    writeFileSync(join(sessions, 'fixture-bad.json'), '{}\n');
    expect(main(['summary', '--sessions', sessions, '--out', out])).toBe(1);
  });
});
