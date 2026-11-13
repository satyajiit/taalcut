// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Real overrides (LRN1-PREF): a library database's swaps counted as the agent's job reads them, the newest 30% held
 * out once there are enough, and the database given never opened (a copy of it is).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { createRepositories, openDatabase } from '@taalcut/library';
import { personSwapEntry } from '@taalcut/timeline/test-support';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../../src/casting-prefs/cli';
import { MIN_REAL_SWAPS, readRealSwaps, renderRealMarkdown } from '../../src/casting-prefs/real';
import { jsonPathFor } from '../../src/report';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function library(swaps: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-prefs-real-test-'));
  dirs.push(dir);
  const path = join(dir, 'library.sqlite');
  const db = unwrap(openDatabase({ path }));
  const repositories = createRepositories(db);
  const project = unwrap(repositories.projects.create({ name: 'Goa' }));
  for (let index = 0; index < swaps; index++)
    unwrap(repositories.auditLog.append(personSwapEntry(project.id, 1_000 + index)));
  db.close();
  return path;
}

describe('real overrides (LRN1-PREF)', () => {
  it('says how many swaps there are when there are too few to hold any out', () => {
    const path = library(3);
    const before = statSync(path);
    const report = readRealSwaps(path);
    expect(report).toMatchObject({
      suite: 'casting-prefs-real',
      synthetic: false,
      claimed: false,
      projects: 1,
      entries: { swaps: 3, personSwaps: 3, withScore: 3, removals: 0 },
      pairs: { count: 6, replaced: 3 },
      enough: false,
      heldOut: null,
    });
    // The database given was never opened: a copy of it was.
    expect(statSync(path).mtimeMs).toBe(before.mtimeMs);
    expect(renderRealMarkdown(report)).toContain(`needs ${MIN_REAL_SWAPS} swaps`);
  });

  it('holds out the newest 30% once there are enough, learned against the defaults', () => {
    const report = readRealSwaps(library(40));
    expect(report.enough).toBe(true);
    const held = report.heldOut;
    if (!held) throw new Error('nothing held out');
    expect(held.heldSwaps).toBe(12);
    // Every swap goes to the shot whose motion matches: the defaults keep the description-heavy pick.
    expect(held.defaults.rate).toBe(0);
    expect(held.learned.motion).toBeGreaterThan(0.15);
    expect(held.learnedAccuracy.rate).toBeGreaterThan(held.defaults.rate);
    expect(renderRealMarkdown(report)).toContain('Held out: the newest 30% (12 swaps)');
  });

  it('`real:casting-prefs` writes the report and its JSON', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'taalcut-prefs-real-out-')), 'real.md');
    dirs.push(join(out, '..'));
    expect(await main(['real', '--db', library(3), '--out', out])).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('Swaps: 3');
    expect(existsSync(jsonPathFor(out))).toBe(true);
    expect(await main(['nope'])).toBe(1);
  });

  it('counts nothing in a library with no projects', () => {
    expect(readRealSwaps(library(0))).toMatchObject({ projects: 1, entries: { swaps: 0 }, enough: false });
  });
});
