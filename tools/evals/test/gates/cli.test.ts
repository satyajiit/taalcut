// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../../src/gates/cli';
import { FIXTURE_FROM, FIXTURE_TO } from '../../src/gates/fixtures';
import { renderHtml } from '../../src/gates/report/html';
import { reportFor, writtenFixture } from './fixture-report';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'taalcut-gates-cli-'));
}

describe('gates CLI', () => {
  it('writes the pass fixture at the top of --out', () => {
    const out = tempDir();
    expect(main(['fixtures', '--out', out, '--case', 'pass'])).toBe(0);
    expect(existsSync(join(out, 'telemetry', 'events.ndjson'))).toBe(true);
    expect(existsSync(join(out, 'pass'))).toBe(false);
    expect(existsSync(join(out, 'cohorts.json'))).toBe(true);
  });

  it('takes the pnpm -- separator and marks every generated file synthetic', () => {
    const out = tempDir();
    expect(main(['fixtures', '--', '--out', out, '--case', 'pass'])).toBe(0);
    const built = reportFor(out, 'v1');
    expect(built.synthetic).toBe(true);
    for (const cell of built.cells) expect(cell.synthetic, cell.metricId).toBe(true);
    expect(readFileSync(join(out, 'crashes.json'), 'utf8')).toContain('"synthetic": true');
  });

  it('writes an HTML report with an inline bar and no external reference', () => {
    const root = writtenFixture('pass');
    const out = tempDir();
    const code = main([
      '--gate',
      'v1',
      '--from',
      FIXTURE_FROM,
      '--to',
      FIXTURE_TO,
      '--out',
      out,
      '--telemetry',
      join(root, 'telemetry'),
      '--evals',
      join(root, 'evals'),
      '--sessions',
      join(root, 'sessions'),
      '--crashes',
      join(root, 'crashes.json'),
      '--ci',
      join(root, 'ci'),
      '--manual',
      join(root, 'manual.json'),
      '--cohorts',
      join(root, 'cohorts.json'),
    ]);
    expect(code).toBe(0);
    const html = readFileSync(join(out, 'report.html'), 'utf8');
    expect(html).toContain('<svg');
    expect(html).toContain('color-scheme');
    expect(html).toContain('prefers-color-scheme');
    expect(html).not.toMatch(/https?:|url\(|<link|<script/i);
    expect(existsSync(join(out, 'report.json'))).toBe(true);
    expect(existsSync(join(out, 'report.md'))).toBe(true);
    const rendered = renderHtml(reportFor(root, 'v1'));
    expect(rendered).toContain('<svg');
    expect(rendered).not.toMatch(/https?:|url\(|<link|<script/i);
  });

  it('exits 1 when a given path cannot be read and does not write a zeroed report', () => {
    const out = tempDir();
    const code = main([
      '--gate',
      'beta',
      '--from',
      FIXTURE_FROM,
      '--to',
      FIXTURE_TO,
      '--out',
      out,
      '--telemetry',
      join(out, 'missing-telemetry'),
    ]);
    expect(code).toBe(1);
    expect(existsSync(join(out, 'report.json'))).toBe(false);
  });
});
