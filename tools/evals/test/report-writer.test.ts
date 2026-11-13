// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The suites' one report writer: the Markdown where asked, the same report as JSON beside it. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { jsonPathFor, writeReport } from '../src/report';

const dir = mkdtempSync(join(tmpdir(), 'taalcut-report-writer-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('writeReport', () => {
  it('writes the Markdown and the JSON beside it, making the folder', () => {
    const out = join(dir, 'nested', 'casting.md');
    writeReport(out, '# Casting\n', { suite: 'casting', synthetic: true });
    expect(readFileSync(out, 'utf8')).toBe('# Casting\n');
    expect(JSON.parse(readFileSync(jsonPathFor(out), 'utf8'))).toEqual({ suite: 'casting', synthetic: true });
    expect(jsonPathFor(out)).toBe(join(dir, 'nested', 'casting.json'));
  });
});
