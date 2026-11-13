// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { armTestCrash } from '../src/main/test-hooks';
import { LAST_RUN_FILE } from '../src/main/crash/last-run';
import { writePrivacyMirror } from '../src/main/crash/privacy-mirror';
import {
  bootCrashReporting,
  crashesRouter,
  endCrashReportingRun,
  noteCrashReportingConsent,
  reportRendererCrash,
  setCrashSecrets,
  type BootCrashReportingOptions,
} from '../src/main/crash/reporting';
import { startIngest, type MockIngest } from './helpers/mock-ingest';

const SECRET = 'planted/keychain+value';
const ENV_TOKEN = 'tok_planted_in_the_environment_7f3e';
const roots: string[] = [];
let ingest: MockIngest | undefined;

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-crash-'));
  roots.push(dir);
  return dir;
}

function optIn(dir: string, localOnly = false): void {
  writePrivacyMirror(join(dir, 'privacy.json'), { crashReports: true, localOnly, changedAt: 1 });
}

async function boot(userData: string, extra: Partial<BootCrashReportingOptions> = {}): Promise<void> {
  ingest ??= await startIngest();
  await bootCrashReporting({
    userData,
    dsn: ingest.dsn,
    version: '1.2.3',
    channel: 'alpha',
    homeDir: homedir(),
    ...extra,
  });
}

function bodies(): string[] {
  return (ingest?.bodies ?? []).map((body) => body.toString('utf8'));
}

afterEach(async () => {
  noteCrashReportingConsent(false);
  setCrashSecrets([]);
  await ingest?.close();
  ingest = undefined;
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('crash reports', () => {
  it('sends one scrubbed report when the user has opted in', async () => {
    const dir = scratch();
    optIn(dir);
    await boot(dir, { env: { CI_DEPLOY_TOKEN: ENV_TOKEN, PLAIN: 'not-a-credential' }, names: ['jdoe-mac'] });
    const b64 = Buffer.from(SECRET).toString('base64');
    const encoded = encodeURIComponent(SECRET);
    setCrashSecrets([SECRET]);
    await reportRendererCrash({
      kind: 'error',
      message: `failed ${homedir()} ${SECRET} ${b64} ${encoded} ${ENV_TOKEN} on JDOE-MAC`,
      stack: `Error: failed\n    at run (${homedir()}/Library/Taalcut/app.ts:3:2)\n${new Error('boom').stack ?? ''}`,
    });
    expect(bodies()).toHaveLength(1);
    const body = bodies()[0] ?? '';
    expect(body).toContain('"type":"event"');
    expect(body).toContain('taalcut@1.2.3');
    expect(body).toContain('"environment":"alpha"');
    expect(body).toContain('[REDACTED]');
    expect(body).toContain('on <name>');
    for (const leak of [homedir(), SECRET, b64, encoded, ENV_TOKEN, 'JDOE-MAC'])
      expect(body).not.toContain(leak);
    expect(crashesRouter).toBeTypeOf('function');
  });

  it('sends nothing and marks no run when opted out', async () => {
    const dir = scratch();
    await boot(dir);
    await reportRendererCrash({ kind: 'unhandledrejection', message: `nope ${SECRET}` });
    expect(bodies()).toHaveLength(0);
    expect(existsSync(join(dir, LAST_RUN_FILE))).toBe(false);
  });

  it('sends nothing when local only is on', async () => {
    const dir = scratch();
    optIn(dir, true);
    await boot(dir);
    await reportRendererCrash({ kind: 'error', message: SECRET });
    expect(bodies()).toHaveLength(0);
  });

  it('drops the next send when reporting is turned off mid-session, and forgets this run', async () => {
    const dir = scratch();
    optIn(dir);
    await boot(dir);
    expect(existsSync(join(dir, LAST_RUN_FILE))).toBe(true);
    await reportRendererCrash({ kind: 'error', message: 'first' });
    noteCrashReportingConsent(false);
    await reportRendererCrash({ kind: 'error', message: 'second' });
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0]).not.toContain('second');
    expect(existsSync(join(dir, LAST_RUN_FILE))).toBe(false);
  });

  it('reports a run that ended without quitting once, at the next launch, under its release', async () => {
    const dir = scratch();
    optIn(dir);
    await boot(dir, { version: '1.2.2' });
    // No quit: the next start finds the run's file.
    await boot(dir);
    await vi.waitFor(() => expect(bodies()).toHaveLength(1));
    expect(bodies()[0]).toContain('main process ended without quitting');
    expect(bodies()[0]).toContain('"release":"taalcut@1.2.2"');
    expect(bodies()[0]).toContain('"last_run":{"version":"1.2.2"');
    // That start quits normally: the one after it has nothing to report.
    endCrashReportingRun();
    await boot(dir);
    await reportRendererCrash({ kind: 'error', message: 'later' });
    expect(bodies().filter((body) => body.includes('ended without quitting'))).toHaveLength(1);
  });

  it('does not report an earlier run once reporting is off at the next launch', async () => {
    const dir = scratch();
    optIn(dir);
    await boot(dir);
    writePrivacyMirror(join(dir, 'privacy.json'), { crashReports: false, localOnly: false, changedAt: 2 });
    await boot(dir);
    await reportRendererCrash({ kind: 'error', message: 'off' });
    expect(bodies()).toHaveLength(0);
    expect(existsSync(join(dir, LAST_RUN_FILE))).toBe(false);
  });

  it('removes the crash dumps folder at every start, opted in or not', async () => {
    for (const on of [false, true]) {
      const dir = scratch();
      if (on) optIn(dir);
      const dumps = join(dir, 'Crashpad');
      mkdirSync(join(dumps, 'pending'), { recursive: true });
      writeFileSync(join(dumps, 'pending', 'old.dmp'), 'MDMP');
      await boot(dir, { crashesDirectory: dumps });
      expect(existsSync(dumps)).toBe(false);
    }
  });

  it('schedules a test-build crash without crashing this process', () => {
    const crashed: string[] = [];
    const pending: Array<() => void> = [];
    armTestCrash(
      () => 'agent',
      (name) => crashed.push(name),
      2000,
      (callback) => pending.push(callback),
    );
    expect(crashed).toEqual([]);
    pending[0]?.();
    expect(crashed).toEqual(['agent']);
    armTestCrash(
      () => undefined,
      () => crashed.push('main'),
      0,
      (callback) => callback(),
    );
    expect(crashed).toEqual(['agent']);
  });
});
