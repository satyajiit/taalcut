// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemorySettingsStore, UPDATE_BLOCKED_SETTING, type TelemetryEvent } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addBlocked,
  blockedVersions,
  isBlocked,
  pruneBlocked,
  refuseBlockedVersions,
  rolledBackBlock,
} from '../src/main/update/blocked';
import { installGuard } from '../src/main/update/guard-binary';
import { createHealthWatch, HEALTH_SIGNALS, writeHealthyMarker } from '../src/main/update/health';
import { createInstallPrep } from '../src/main/update/install-prep';
import { rollbackTelemetryReason, takeRollbackNotice } from '../src/main/update/rollback-notice';
import {
  pendingUpdateSchema,
  readUpdateFile,
  updatePaths,
  writeUpdateFile,
  type UpdatePaths,
} from '../src/main/update/update-files';
import { recordUpdateInstalled, recordUpdateRolledBack } from '../src/main/update/update-telemetry';

let userData: string;
let paths: UpdatePaths;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'taalcut-rollback-'));
  paths = updatePaths(userData);
});
afterEach(() => rmSync(userData, { recursive: true, force: true }));

describe('health watch', () => {
  it('is healthy only when every signal arrives within the deadline, and says so once', () => {
    let now = 1_000;
    const onHealthy = vi.fn();
    const watch = createHealthWatch({ now: () => now, startedAt: 0, onHealthy });
    for (const signal of HEALTH_SIGNALS.slice(0, -1)) watch.mark(signal);
    watch.mark('database');
    expect(onHealthy).not.toHaveBeenCalled();
    now = 59_000;
    watch.mark('renderer');
    watch.mark('renderer');
    expect(onHealthy).toHaveBeenCalledTimes(1);
    expect(watch.healthy).toBe(true);
  });

  it('writes nothing for a launch that took too long: the guard decides', () => {
    let now = 0;
    const onHealthy = vi.fn();
    const watch = createHealthWatch({ now: () => now, startedAt: 0, onHealthy, deadlineMs: 60_000 });
    watch.mark('database');
    now = 60_001;
    for (const signal of HEALTH_SIGNALS) watch.mark(signal);
    expect(onHealthy).not.toHaveBeenCalled();
    expect(watch.healthy).toBe(false);
  });

  it('writes an empty 0600 marker', () => {
    mkdirSync(paths.dir, { recursive: true });
    writeHealthyMarker(paths.healthy('2.0.0'));
    expect(statSync(paths.healthy('2.0.0')).size).toBe(0);
    expect(statSync(paths.healthy('2.0.0')).mode & 0o777).toBe(0o600);
  });
});

describe('install prep', () => {
  const guardPath = () => join(userData, 'Taalcut.app', 'Contents', 'Resources', 'bin', 'taalcut');
  const setupDeps = () => ({
    paths,
    appPath: '/Applications/Taalcut.app',
    version: '1.2.0',
    library: join(userData, 'catalog', 'library.sqlite'),
    guardSource: guardPath(),
    bundles: { clone: async () => undefined, remove: async () => undefined },
    spawnDetached: () => undefined,
    now: () => 42,
    exists: (path: string) => path === guardPath(),
  });
  const setup = (guardExists = true) => {
    const guardSource = guardPath();
    const clone = vi.fn(async () => undefined);
    const copies: string[][] = [];
    // Records when the guard starts relative to the copies (the copy must come right before).
    const spawnDetached = vi.fn(() => void copies.push(['spawn']));
    const prep = createInstallPrep({
      paths,
      appPath: '/Applications/Taalcut.app',
      version: '1.2.0',
      library: join(userData, 'catalog', 'library.sqlite'),
      guardSource,
      bundles: { clone, remove: async () => undefined },
      spawnDetached,
      now: () => 42,
      exists: (path) => guardExists && path === guardSource,
      copyExecutable: (from, to) => copies.push([from, to]),
    });
    return { prep, clone, spawnDetached, copies, guardSource };
  };

  it('clones the app, then writes pending.json; arms a fresh copy of the guard once', async () => {
    const { prep, clone, spawnDetached, copies, guardSource } = setup();
    expect(prep.arm()).toEqual({ ok: true, value: false });
    const prepared = await prep.prepare({ to: '1.3.0', channel: 'stable', delta: true });
    expect(prepared.ok).toBe(true);
    expect(clone).toHaveBeenCalledWith('/Applications/Taalcut.app', paths.rollbackApp('1.2.0'));
    // Nothing is copied at staging: a guard left in updates/ for hours could be swapped (SB-40).
    expect(copies).toEqual([]);
    const pending = readUpdateFile(paths.pending, pendingUpdateSchema);
    expect(pending.ok && pending.value).toEqual({
      v: 1,
      from: '1.2.0',
      to: '1.3.0',
      appPath: '/Applications/Taalcut.app',
      rollbackApp: paths.rollbackApp('1.2.0'),
      library: join(userData, 'catalog', 'library.sqlite'),
      at: 42,
      launchAttempts: 0,
      channel: 'stable',
      delta: true,
    });
    expect(prep.arm()).toEqual({ ok: true, value: true });
    expect(prep.arm()).toEqual({ ok: true, value: false });
    expect(copies).toEqual([[guardSource, paths.guardBinary], ['spawn']]);
    expect(spawnDetached).toHaveBeenCalledTimes(1);
    expect(spawnDetached).toHaveBeenCalledWith(
      paths.guardBinary,
      ['update-guard', '--pending', paths.pending],
      paths.guardLog,
    );
  });

  it('has no rollback without a guard, and writes no pending file when the clone fails', async () => {
    const missing = setup(false);
    const refused = await missing.prep.prepare({ to: '1.3.0' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'desktop.update_guard_missing' } });
    const failing = setup();
    failing.clone.mockRejectedValueOnce(new Error('disk full'));
    const failed = await failing.prep.prepare({ to: '1.3.0' });
    expect(failed).toMatchObject({ ok: false, error: { code: 'desktop.update_prep_failed' } });
    expect(existsSync(paths.pending)).toBe(false);
    expect(failing.prep.arm()).toEqual({ ok: true, value: false });
  });

  it("doesn't start the guard when its copy fails, and can try again", async () => {
    const spawnDetached = vi.fn();
    let fail = true;
    const prep = createInstallPrep({
      ...setupDeps(),
      spawnDetached,
      copyExecutable: () => {
        if (fail) throw new Error('disk full');
      },
    });
    expect((await prep.prepare({ to: '1.3.0' })).ok).toBe(true);
    expect(prep.arm()).toMatchObject({
      ok: false,
      error: { code: 'desktop.update_prep_failed', detail: 'guard: disk full' },
    });
    expect(spawnDetached).not.toHaveBeenCalled();
    fail = false;
    expect(prep.arm()).toEqual({ ok: true, value: true });
    expect(spawnDetached).toHaveBeenCalledTimes(1);
  });
});

describe('the guard binary (SB-40)', () => {
  it('replaces the copy in updates/ by a rename, so a guard running from the old file keeps it', () => {
    const source = join(userData, 'bin', 'taalcut');
    mkdirSync(join(userData, 'bin'));
    writeFileSync(source, 'signed guard');
    writeFileSync(join(userData, 'planted'), 'planted guard');
    installGuard(join(userData, 'planted'), paths.guardBinary);
    const running = openSync(paths.guardBinary, 'r');
    try {
      installGuard(source, paths.guardBinary);
      expect(readFileSync(paths.guardBinary, 'utf8')).toBe('signed guard');
      expect(statSync(paths.guardBinary).mode & 0o777).toBe(0o755);
      expect(statSync(join(paths.guardBinary, '..')).mode & 0o777).toBe(0o700);
      const old = Buffer.alloc(13);
      readSync(running, old, 0, 13, 0);
      expect(old.toString()).toBe('planted guard');
    } finally {
      closeSync(running);
    }
  });
});

describe('rollback notice', () => {
  const rolledBack = { v: 1, from: '1.2.0', to: '1.3.0', reason: 'launch-failed', at: 7 } as const;

  it('takes a fresh rollback once, then keeps showing it as the last one', () => {
    expect(takeRollbackNotice(paths)).toEqual({ last: null, fresh: null, installFailed: null, problems: [] });
    writeUpdateFile(paths.rolledBack, rolledBack);
    const first = takeRollbackNotice(paths);
    expect(first.fresh).toEqual(rolledBack);
    expect(first.last).toEqual({ from: '1.2.0', to: '1.3.0', at: 7 });
    expect(existsSync(paths.rolledBack)).toBe(false);
    const second = takeRollbackNotice(paths);
    expect(second.fresh).toBeNull();
    expect(second.last).toEqual({ from: '1.2.0', to: '1.3.0', at: 7 });
  });

  it("takes the guard's times as it writes them: milliseconds with a fraction, rounded", () => {
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.rolledBack, JSON.stringify({ ...rolledBack, at: 1760435429438.6191 }));
    writeFileSync(paths.installFailed, JSON.stringify({ v: 1, from: '1.2.0', to: '1.3.0', at: 12.5 }));
    const notice = takeRollbackNotice(paths);
    expect(notice.problems).toEqual([]);
    expect(notice.fresh).toEqual({ ...rolledBack, at: 1760435429439 });
    expect(notice.last).toEqual({ from: '1.2.0', to: '1.3.0', at: 1760435429439 });
    expect(notice.installFailed).toEqual({ from: '1.2.0', to: '1.3.0' });
  });

  it('logs and removes an install that never happened, and a damaged notice', () => {
    writeUpdateFile(paths.installFailed, { v: 1, from: '1.2.0', to: '1.3.0', at: 1 });
    writeFileSync(paths.rolledBack, '{"v":2}');
    const notice = takeRollbackNotice(paths);
    expect(notice.installFailed).toEqual({ from: '1.2.0', to: '1.3.0' });
    expect(notice.problems.map((problem) => problem.code)).toEqual(['desktop.update_file_invalid']);
    expect(existsSync(paths.installFailed)).toBe(false);
    expect(existsSync(paths.rolledBack)).toBe(false);
  });

  it("maps the guard's reasons onto the telemetry catalogue's, and records only catalogue events", () => {
    expect(rollbackTelemetryReason('launch-failed')).toBe('exited');
    expect(rollbackTelemetryReason('install-timeout')).toBe('exited');
    expect(rollbackTelemetryReason('hung')).toBe('hung');
    expect(rollbackTelemetryReason('rollback-now')).toBe('attempts');
    const events: TelemetryEvent[] = [];
    const telemetry = { record: (event: TelemetryEvent) => events.push(event) };
    recordUpdateRolledBack(telemetry, rolledBack);
    recordUpdateInstalled(
      telemetry,
      {
        v: 1,
        from: '1.2.0',
        to: '1.3.0-beta.1',
        appPath: '/A',
        rollbackApp: '/B',
        library: '/C',
        at: 1,
        launchAttempts: 1,
        delta: true,
      },
      'beta',
    );
    // No channel at all (a build without one): nothing to say which cohort it was.
    recordUpdateInstalled(
      telemetry,
      {
        v: 1,
        from: '1.2.0',
        to: '1.3.0',
        appPath: '/A',
        rollbackApp: '/B',
        library: '/C',
        at: 1,
        launchAttempts: 1,
      },
      null,
    );
    expect(events).toEqual([
      { name: 'update.rolledBack', from: '1.2.0', to: '1.3.0', reason: 'exited' },
      { name: 'update.installed', from: '1.2.0', to: '1.3.0-beta.1', channel: 'beta', delta: true },
    ]);
  });
});

describe('blocked versions', () => {
  it('prunes versions the running one makes moot, keeps at most 32, and matches exactly', () => {
    expect(pruneBlocked(['1.2.0', '1.3.0-beta.2', '1.3.0', 'junk'], '1.3.0-beta.5')).toEqual([
      '1.3.0',
      'junk',
    ]);
    const many = Array.from({ length: 40 }, (_, index) => `1.0.${index}`);
    expect(addBlocked(many, '2.0.0')).toHaveLength(32);
    expect(addBlocked(['1.0.0'], '1.0.0')).toEqual(['1.0.0']);
    expect(isBlocked(['1.3.0'], ' 1.3.0 ')).toBe(true);
    expect(isBlocked(['1.3.0'], '1.3.1')).toBe(false);
  });

  it('refuses the version last rolled back from at once, until a newer one runs', () => {
    expect(rolledBackBlock('1.3.0-beta.2', '1.3.0-beta.1')).toEqual(['1.3.0-beta.2']);
    expect(rolledBackBlock('1.3.0-beta.2', '1.3.0-beta.3')).toEqual([]);
    expect(rolledBackBlock(undefined, '1.3.0-beta.1')).toEqual([]);
  });

  it("refuses a blocked version before electron-updater's own check, and defers to it otherwise", async () => {
    const base = vi.fn((_info: { readonly version: string }) => true);
    const updater = { isUpdateSupported: base };
    refuseBlockedVersions(updater, () => ['1.3.0']);
    expect(await updater.isUpdateSupported({ version: '1.3.0' })).toBe(false);
    expect(base).not.toHaveBeenCalled();
    expect(await updater.isUpdateSupported({ version: '1.3.1' })).toBe(true);
    expect(base).toHaveBeenCalledWith({ version: '1.3.1' });
  });

  it('keeps the list in the settings store, written by main directly', async () => {
    const settings = createMemorySettingsStore();
    await settings.set(UPDATE_BLOCKED_SETTING, ['1.1.0', '1.4.0']);
    const blocked = blockedVersions(settings);
    expect(blocked.list()).toEqual([]);
    expect(await blocked.load('1.2.0')).toEqual({ ok: true, value: ['1.4.0'] });
    expect(blocked.list()).toEqual(['1.4.0']);
    await blocked.block('1.5.0');
    expect(blocked.list()).toEqual(['1.4.0', '1.5.0']);
    expect(await settings.get(UPDATE_BLOCKED_SETTING)).toEqual({ ok: true, value: ['1.4.0', '1.5.0'] });
  });
});
