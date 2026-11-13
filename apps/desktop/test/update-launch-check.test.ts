// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkLaunch, guardArguments, ROLLBACK_AFTER_ATTEMPTS } from '../src/main/update/launch-check';
import {
  pendingUpdateSchema,
  readUpdateFile,
  updatePaths,
  writeUpdateFile,
  type PendingUpdate,
  type UpdatePaths,
} from '../src/main/update/update-files';

let userData: string;
let paths: UpdatePaths;

const pending = (overrides: Partial<PendingUpdate> = {}): PendingUpdate => ({
  v: 1,
  from: '1.3.0-beta.1',
  to: '1.3.0-beta.2',
  appPath: '/Applications/Taalcut.app',
  rollbackApp: `${userData}/updates/rollback/Taalcut-1.3.0-beta.1.app`,
  library: `${userData}/catalog/library.sqlite`,
  at: 1_000,
  launchAttempts: 0,
  ...overrides,
});

const stored = () => {
  const read = readUpdateFile(paths.pending, pendingUpdateSchema);
  if (!read.ok) throw new Error(read.error.code);
  return read.value;
};

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'taalcut-launch-'));
  paths = updatePaths(userData);
});
afterEach(() => rmSync(userData, { recursive: true, force: true }));

describe('update files', () => {
  it('names every file in updates/ and refuses a version that could escape it', () => {
    expect(paths.pending).toBe(join(userData, 'updates', 'pending.json'));
    expect(paths.healthy('1.3.0-beta.2')).toBe(join(userData, 'updates', 'healthy-1.3.0-beta.2'));
    expect(paths.rollbackApp('1.2.0')).toBe(join(userData, 'updates', 'rollback', 'Taalcut-1.2.0.app'));
    expect(() => paths.healthy('../../evil')).toThrow();
  });

  it('writes atomically with 0600, reads back, and reports a damaged file instead of trusting it', () => {
    expect(readUpdateFile(paths.pending, pendingUpdateSchema)).toEqual({ ok: true, value: null });
    expect(writeUpdateFile(paths.pending, pending()).ok).toBe(true);
    expect(statSync(paths.pending).mode & 0o777).toBe(0o600);
    expect(stored()).toEqual(pending());
    writeFileSync(paths.pending, '{"v":1,"from":"1.0.0"}');
    const damaged = readUpdateFile(paths.pending, pendingUpdateSchema);
    expect(damaged.ok).toBe(false);
    if (!damaged.ok)
      expect(damaged.error).toMatchObject({
        code: 'desktop.update_file_invalid',
        params: { file: 'pending.json' },
      });
    writeFileSync(paths.pending, 'not json');
    expect(readUpdateFile(paths.pending, pendingUpdateSchema).ok).toBe(false);
  });
});

describe('checkLaunch', () => {
  it('does not count windowless timer wakes as failed interactive update launches', () => {
    writeUpdateFile(paths.pending, pending({ launchAttempts: 2 }));
    for (let wake = 0; wake < 5; wake++) {
      expect(checkLaunch({ paths, version: '1.3.0-beta.2', background: true })).toEqual({
        kind: 'normal',
        cleanup: [],
      });
    }
    expect(stored()?.launchAttempts).toBe(2);
    expect(existsSync(paths.healthy('1.3.0-beta.2'))).toBe(false);
    expect(checkLaunch({ paths, version: '1.3.0-beta.2' }).kind).toBe('rollback-now');
  });

  it('does nothing without a pending update, or while the old version still runs', () => {
    expect(checkLaunch({ paths, version: '1.3.0-beta.1' })).toEqual({ kind: 'normal', cleanup: [] });
    writeUpdateFile(paths.pending, pending());
    expect(checkLaunch({ paths, version: '1.3.0-beta.1' })).toEqual({ kind: 'normal', cleanup: [] });
    expect(stored()?.launchAttempts).toBe(0);
  });

  it('counts each launch of the new version, and hands over to the guard at the third', () => {
    writeUpdateFile(paths.pending, pending());
    const first = checkLaunch({ paths, version: '1.3.0-beta.2' });
    expect(first).toMatchObject({ kind: 'updated', pending: { launchAttempts: 1 } });
    expect(checkLaunch({ paths, version: '1.3.0-beta.2' })).toMatchObject({
      kind: 'updated',
      pending: { launchAttempts: 2 },
    });
    const third = checkLaunch({ paths, version: '1.3.0-beta.2' });
    expect(third).toMatchObject({
      kind: 'rollback-now',
      pending: { launchAttempts: ROLLBACK_AFTER_ATTEMPTS },
    });
    expect(stored()?.launchAttempts).toBe(3);
  });

  it('cleans up on the launch after a healthy one', () => {
    writeUpdateFile(paths.pending, pending({ launchAttempts: 1 }));
    writeFileSync(paths.healthy('1.3.0-beta.2'), '');
    const verdict = checkLaunch({ paths, version: '1.3.0-beta.2' });
    expect(verdict).toEqual({
      kind: 'normal',
      cleanup: [paths.rollbackDir, paths.guardDir, paths.failedDir],
    });
    expect(existsSync(paths.pending)).toBe(false);
  });

  it("doesn't count a marker from an earlier try of the same version", () => {
    writeUpdateFile(paths.pending, pending({ at: 50_000 }));
    const stale = checkLaunch({ paths, version: '1.3.0-beta.2', modifiedAt: () => 10_000 });
    expect(stale).toMatchObject({ kind: 'updated', pending: { launchAttempts: 1 } });
    const fresh = checkLaunch({ paths, version: '1.3.0-beta.2', modifiedAt: () => 49_500 });
    expect(fresh).toMatchObject({ kind: 'normal' });
  });

  it('drops a pending update a later version made moot, and a damaged one', () => {
    writeUpdateFile(paths.pending, pending());
    expect(checkLaunch({ paths, version: '1.3.0' })).toMatchObject({
      kind: 'normal',
      cleanup: [paths.rollbackDir, paths.guardDir, paths.failedDir],
    });
    expect(existsSync(paths.pending)).toBe(false);
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.pending, '{');
    const damaged = checkLaunch({ paths, version: '1.3.0' });
    expect(damaged).toMatchObject({ kind: 'normal', problem: { code: 'desktop.update_file_invalid' } });
    expect(existsSync(paths.pending)).toBe(false);
  });

  it('gives the guard the pending file, and --rollback-now only when asked', () => {
    expect(guardArguments(paths.pending, 'watch')).toEqual(['update-guard', '--pending', paths.pending]);
    expect(guardArguments(paths.pending, 'rollback-now')).toEqual([
      'update-guard',
      '--pending',
      paths.pending,
      '--rollback-now',
    ]);
  });
});
