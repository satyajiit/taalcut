// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../../src/soak/cli';
import { readSoakResults } from '../../src/soak/result';
import {
  IMPORT_BATCH_SIZE,
  SMOKE_BATCHES,
  SMOKE_UPLOADS,
  smokeLateSampleIndex,
} from '../../src/soak/scenarios/import-index-8h';
import { SMOKE_RENDERS } from '../../src/soak/scenarios/renders-50';
import { runSmoke, smokeApp } from '../../src/soak/smoke';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-soak-'));
  dirs.push(dir);
  return dir;
}

describe('runSmoke', () => {
  it('returns three passing results and does not arm a timer', async () => {
    const started = Date.now();
    const app = smokeApp();
    const results = await runSmoke({ app });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(results.map((result) => result.scenario)).toEqual([
      'import-index-8h',
      'renders-50',
      'update-under-load',
    ]);
    expect(results.map((result) => result.verdict)).toEqual(['pass', 'pass', 'pass']);
    expect(results.every((result) => result.synthetic && result.mode === 'smoke' && result.v === 1)).toBe(
      true,
    );
    const recorded = SMOKE_BATCHES * IMPORT_BATCH_SIZE + SMOKE_UPLOADS + SMOKE_RENDERS + 2;
    expect(app.assets.size).toBe(recorded);
  });

  it('fails growth when RSS rises 11%', async () => {
    const late = smokeLateSampleIndex();
    const app = smokeApp();
    app.rssScript = Array.from({ length: late + 8 }, (_, index) => (index >= late ? 1110 : 1000));
    const results = await runSmoke({ app });
    const imported = results.find((result) => result.scenario === 'import-index-8h');
    expect(imported?.verdict).toBe('fail');
    expect(imported?.detail).toContain('main');
    expect(
      imported?.growth.some((row) => row.process === 'main' && row.ratio !== null && row.ratio > 0.1),
    ).toBe(true);
  });
});

describe('soak cli', () => {
  it('writes passing smoke rows', async () => {
    const out = join(scratch(), 'smoke.jsonl');
    const code = await main(['run', '--scenario', 'all', '--mode', 'smoke', '--out', out]);
    expect(code).toBe(0);
    const rows = readSoakResults(out);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.verdict === 'pass' && row.synthetic)).toBe(true);
  });

  it('records an unwired full run as missing and does not pretend it passed', async () => {
    const out = join(scratch(), 'full.jsonl');
    const started = Date.now();
    const code = await main(['run', '--scenario', 'all', '--mode', 'full', '--out', out, '--real']);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(code).toBe(1);
    const rows = readSoakResults(out);
    expect(rows).toHaveLength(3);
    expect(
      rows.every((row) => row.verdict === 'missing' && row.detail === 'no app wired' && !row.synthetic),
    ).toBe(true);
  });
});
