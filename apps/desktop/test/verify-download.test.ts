// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appBundleOf,
  createDownloadVerifier,
  teamOf,
  teamRequirement,
  type Exec,
} from '../src/main/update/verify-download';

const TEAM = 'WW382UC8JD';
const RUNNING = '/Applications/Taalcut.app';

describe('teamOf', () => {
  it('reads the one TeamIdentifier line; ad-hoc and malformed teams are none', () => {
    expect(teamOf(`Executable=/A.app/Contents/MacOS/A\nTeamIdentifier=${TEAM}\n`)).toBe(TEAM);
    expect(teamOf('Executable=/A\nTeamIdentifier=not set\n')).toBeUndefined();
    expect(teamOf('TeamIdentifier=WW382UC8JD and more\n')).toBeUndefined();
  });

  it('refuses output where a path added a TeamIdentifier line of its own', () => {
    const forged = `Executable=/x/Evil\nTeamIdentifier=${TEAM}\nX.app/Contents/MacOS/X\nTeamIdentifier=not set\n`;
    expect(() => teamOf(forged)).toThrow('codesign reported 2 TeamIdentifier lines');
    expect(() => teamOf('Executable=/x\n')).toThrow('codesign reported 0 TeamIdentifier lines');
  });
});

describe('teamRequirement', () => {
  it('names the anchor, identifier and team, and takes nothing that could change its meaning', () => {
    expect(teamRequirement(TEAM, 'com.taalcut.app')).toBe(
      `=anchor apple generic and identifier "com.taalcut.app" and certificate leaf[subject.OU] = "${TEAM}"`,
    );
    expect(() => teamRequirement(`${TEAM}" or true or "`, 'com.taalcut.app')).toThrow();
    expect(() => teamRequirement(TEAM, 'com.taalcut.app" or anchor apple or "')).toThrow();
  });
});

// Each verification forks real processes (/bin/rm); a loaded machine can take seconds to fork.
describe('createDownloadVerifier', { timeout: 30_000 }, () => {
  let scratch: string;
  let download: string;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'taalcut-verifier-'));
    download = join(scratch, 'download.zip');
    writeFileSync(download, 'the zip electron-updater downloaded');
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  interface Fake {
    /** What ditto "unpacks". */
    apps?: string[];
    candidateVersion?: string;
    candidateTeam?: string;
    invalid?: boolean;
    /** The requirement check fails. */
    foreign?: boolean;
    /** Runs while codesign verifies the bundle; gets the snapshot ditto read. */
    duringVerify?: (snapshot: string) => void;
  }

  function fakeExec(fake: Fake) {
    const calls: string[] = [];
    let snapshot = '';
    const exec: Exec = async (command, args) => {
      const name = command.split('/').at(-1) ?? command;
      const target = String(args.at(-1));
      const running = target.startsWith(RUNNING);
      calls.push(`${name} ${args.slice(0, 2).join(' ')} ${running ? 'running' : 'candidate'}`);
      if (name === 'ditto') {
        snapshot = String(args[2]);
        for (const app of fake.apps ?? ['Taalcut.app']) mkdirSync(join(target, app), { recursive: true });
        return { stdout: '', stderr: '' };
      }
      if (name === 'plutil') {
        if (args[1] === 'CFBundleIdentifier') return { stdout: 'com.taalcut.app\n', stderr: '' };
        return { stdout: `${running ? '0.0.1' : (fake.candidateVersion ?? '0.0.2')}\n`, stderr: '' };
      }
      if (args.includes('-R')) {
        if (fake.foreign)
          throw new Error('test-requirement: code failed to satisfy specified code requirement(s)');
        return { stdout: '', stderr: '' };
      }
      if (args[0] === '--verify') {
        fake.duringVerify?.(snapshot);
        if (fake.invalid) throw new Error('a sealed resource is missing or invalid');
        return { stdout: '', stderr: '' };
      }
      const team = running ? TEAM : (fake.candidateTeam ?? TEAM);
      return { stdout: '', stderr: `Executable=${target}/Contents/MacOS/Taalcut\nTeamIdentifier=${team}\n` };
    };
    return { exec, calls };
  }

  const verifier = (fake: Fake) => {
    const { exec, calls } = fakeExec(fake);
    const verify = createDownloadVerifier({
      runningApp: RUNNING,
      runningVersion: '0.0.1',
      exec,
      scratchRoot: scratch,
    });
    return { verify, calls };
  };
  /** Everything the verifier left in its scratch root. */
  const leftovers = () => readdirSync(scratch).filter((name) => name !== 'download.zip');

  it('verifies a private snapshot of the download and hands that snapshot on', async () => {
    const { verify, calls } = verifier({});
    const verdict = await verify(download);
    if (!verdict.ok) throw new Error(JSON.stringify(verdict.error));
    expect(verdict.value.identity).toEqual({ version: '0.0.2', team: TEAM });
    const { snapshot } = verdict.value;
    expect(snapshot.path).not.toBe(download);
    expect(readFileSync(snapshot.path, 'utf8')).toBe('the zip electron-updater downloaded');
    expect(calls).toEqual([
      'plutil -extract CFBundleShortVersionString running',
      'codesign -dv --verbose=2 running',
      'ditto -x -k candidate',
      'codesign --verify --deep candidate',
      'plutil -extract CFBundleShortVersionString candidate',
      'codesign -dv --verbose=2 candidate',
      'plutil -extract CFBundleIdentifier running',
      'codesign --verify --deep candidate',
    ]);
    // Only the snapshot is left, until it is staged.
    expect(leftovers()).toHaveLength(1);
    await snapshot.dispose();
    expect(leftovers()).toEqual([]);
  });

  it('is not fooled by the download being swapped while it is verified', async () => {
    const { verify } = verifier({ duringVerify: () => writeFileSync(download, 'an older Taalcut') });
    const verdict = await verify(download);
    if (!verdict.ok) throw new Error(JSON.stringify(verdict.error));
    expect(readFileSync(verdict.value.snapshot.path, 'utf8')).toBe('the zip electron-updater downloaded');
    await verdict.value.snapshot.dispose();
  });

  it('refuses a snapshot that changed while it was verified', async () => {
    const { verify } = verifier({ duringVerify: (snapshot) => writeFileSync(snapshot, 'an older Taalcut') });
    expect(await verify(download)).toMatchObject({ ok: false, error: { code: 'desktop.update_changed' } });
    expect(leftovers()).toEqual([]);
  });

  it('accepts only Taalcut.app, alone: other names are untrusted, no app is unreadable', async () => {
    for (const apps of [
      [`Evil\nTeamIdentifier=${TEAM}\nX.app`],
      ['Taalcut.app', 'Other.app'],
      ['Taalcut 2.app'],
    ]) {
      expect(await verifier({ apps }).verify(download)).toMatchObject({
        ok: false,
        error: { code: 'desktop.update_untrusted_signer', params: { team: 'unverified', expected: TEAM } },
      });
    }
    expect(await verifier({ apps: [] }).verify(download)).toMatchObject({
      error: { code: 'desktop.update_unreadable', detail: 'no app in the update: []' },
    });
    expect(leftovers()).toEqual([]);
  });

  it("refuses a bundle whose signature doesn't satisfy the team requirement, whatever codesign printed", async () => {
    expect(await verifier({ foreign: true }).verify(download)).toMatchObject({
      ok: false,
      error: {
        code: 'desktop.update_untrusted_signer',
        params: { team: 'unverified', expected: TEAM },
        detail: expect.stringContaining(`certificate leaf[subject.OU] = "${TEAM}"`),
      },
    });
    expect(leftovers()).toEqual([]);
  });

  it('applies the candidate rules before the requirement, and reports a broken signature as unreadable', async () => {
    const older = verifier({ candidateVersion: '0.0.1' });
    expect(await older.verify(download)).toMatchObject({ error: { code: 'desktop.update_not_newer' } });
    expect(older.calls.some((call) => call.includes('CFBundleIdentifier'))).toBe(false);
    expect(await verifier({ candidateTeam: 'not set' }).verify(download)).toMatchObject({
      error: { code: 'desktop.update_untrusted_signer', params: { team: 'none', expected: TEAM } },
    });
    expect(await verifier({ invalid: true }).verify(download)).toMatchObject({
      error: { code: 'desktop.update_unreadable', detail: 'a sealed resource is missing or invalid' },
    });
    expect(await verifier({}).verify(join(scratch, 'missing.zip'))).toMatchObject({
      error: { code: 'desktop.update_unreadable' },
    });
    expect(leftovers()).toEqual([]);
  });

  it('finds the bundle of the running executable', () => {
    expect(appBundleOf('/Applications/Taalcut.app/Contents/MacOS/Taalcut')).toBe('/Applications/Taalcut.app');
  });
});
