// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { AfterPackContext, BuildResult } from 'electron-builder';
import { describe, expect, it, vi } from 'vitest';
import {
  createDistributionHooks,
  credentialArgs,
  keychainProfileExists,
  notarizeAndStaple,
  notaryCredentials,
  notaryDecision,
  notaryProfile,
} from '../packaging/notarize';
import type { CommandResult, Run } from '../packaging/run';
import { AD_HOC } from '../packaging/signing';

const DEVELOPER_ID = 'Developer ID Application: Matterward Labs Private Limited (WW382UC8JD)';
const ACCEPTED = JSON.stringify({ id: 'sub-1', status: 'Accepted', message: 'Processing complete' });
const ok = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '' });

/** Records every command; answers notarytool submit with `submit`. */
function fakeRun(submit: CommandResult = ok(ACCEPTED)) {
  const calls: string[][] = [];
  const run: Run = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'notarytool' && args[1] === 'submit') return submit;
    if (args[0] === 'notarytool' && args[1] === 'log') return ok('{"issues":[{"message":"not signed"}]}');
    return ok();
  };
  return { run, calls, commands: () => calls.map((call) => call.slice(0, 3).join(' ')) };
}

const context = (platform = 'darwin') =>
  ({
    appOutDir: '/release/mac-arm64',
    electronPlatformName: platform,
    packager: { appInfo: { productFilename: 'Taalcut' } },
  }) as unknown as AfterPackContext;

const artifacts = (...artifactPaths: string[]) => ({ artifactPaths }) as unknown as BuildResult;

describe('notaryDecision', () => {
  const base = { env: {}, identity: DEVELOPER_ID, flavour: 'release' as const, profileExists: () => true };

  it('notarises Developer ID release builds whose keychain profile exists', () => {
    expect(notaryDecision(base)).toEqual({ notarize: true, credentials: { profile: 'taalcut-notary' } });
    expect(notaryProfile({ TAALCUT_NOTARY_PROFILE: ' ci-notary ' })).toBe('ci-notary');
  });

  it('takes the CI profile and its temporary keychain from the environment', () => {
    const env = { TAALCUT_NOTARY_PROFILE: 'ci-notary', TAALCUT_NOTARY_KEYCHAIN: ' /tmp/ci.keychain-db ' };
    const seen: unknown[] = [];
    const decision = notaryDecision({
      ...base,
      env,
      profileExists: (credentials) => (seen.push(credentials), true),
    });
    const credentials = { profile: 'ci-notary', keychain: '/tmp/ci.keychain-db' };
    expect(decision).toEqual({ notarize: true, credentials });
    expect(seen).toEqual([credentials]);
    expect(notaryCredentials({ TAALCUT_NOTARY_KEYCHAIN: ' ' })).toEqual({ profile: 'taalcut-notary' });
    expect(credentialArgs(credentials)).toEqual([
      '--keychain-profile',
      'ci-notary',
      '--keychain',
      '/tmp/ci.keychain-db',
    ]);
  });

  it('says why it skips: ad-hoc, a test build, TAALCUT_NOTARIZE=0, or no profile', () => {
    const reason = (overrides: Partial<Parameters<typeof notaryDecision>[0]>) => {
      const decision = notaryDecision({ ...base, ...overrides });
      return decision.notarize ? 'notarise' : decision.reason;
    };
    expect(reason({ identity: AD_HOC })).toMatch(/signed ad-hoc/);
    expect(reason({ flavour: 'test' })).toBe('test builds are never notarised');
    expect(reason({ env: { TAALCUT_NOTARIZE: '0' } })).toBe('TAALCUT_NOTARIZE=0');
    expect(reason({ profileExists: () => false })).toMatch(
      /^keychain profile "taalcut-notary" not found\. Store it once with: xcrun notarytool store-credentials/,
    );
    expect(
      reason({ env: { TAALCUT_NOTARY_KEYCHAIN: '/k.keychain-db' }, profileExists: () => false }),
    ).toMatch(/^keychain profile "taalcut-notary" not found in \/k\.keychain-db\./);
  });

  it('fails instead of skipping when TAALCUT_NOTARIZE=1 (the release workflow)', () => {
    const required = { ...base, env: { TAALCUT_NOTARIZE: '1' } };
    expect(notaryDecision(required)).toEqual({ notarize: true, credentials: { profile: 'taalcut-notary' } });
    expect(() => notaryDecision({ ...required, profileExists: () => false })).toThrow(
      /^TAALCUT_NOTARIZE=1, but notarisation would be skipped: keychain profile "taalcut-notary" not found/,
    );
    expect(() => notaryDecision({ ...required, identity: AD_HOC })).toThrow(/signed ad-hoc/);
    expect(() => notaryDecision({ ...required, flavour: 'test' })).toThrow(/test builds/);
  });
});

describe('keychainProfileExists', () => {
  it('asks notarytool for the history and keeps only the exit status', () => {
    const calls: readonly string[][] = [];
    const run: Run = (command, args) => {
      (calls as string[][]).push([command, ...args]);
      return { status: 69, stdout: 'secret-ish', stderr: 'No Keychain password item found' };
    };
    expect(keychainProfileExists({ profile: 'taalcut-notary' }, run)).toBe(false);
    expect(keychainProfileExists({ profile: 'ci', keychain: '/k.keychain-db' }, run)).toBe(false);
    expect(calls).toEqual([
      ['xcrun', 'notarytool', 'history', '--keychain-profile', 'taalcut-notary', '--output-format', 'json'],
      [
        'xcrun',
        'notarytool',
        'history',
        '--keychain-profile',
        'ci',
        '--keychain',
        '/k.keychain-db',
        '--output-format',
        'json',
      ],
    ]);
  });
});

describe('notarizeAndStaple', () => {
  it('zips an app with ditto, submits it with the profile, waits, and staples the app', () => {
    const fake = fakeRun();
    notarizeAndStaple('/r/Taalcut.app', { profile: 'taalcut-notary' }, fake.run, () => {});
    expect(fake.commands()).toEqual(['ditto -c -k', 'xcrun notarytool submit', 'xcrun stapler staple']);
    const submit = fake.calls[1] ?? [];
    expect(submit.slice(4)).toEqual([
      '--keychain-profile',
      'taalcut-notary',
      '--wait',
      '--output-format',
      'json',
    ]);
    expect(submit[3]).toMatch(/taalcut-notary-.*\/Taalcut\.app\.zip$/);
    expect(fake.calls[2]).toEqual(['xcrun', 'stapler', 'staple', '/r/Taalcut.app']);
  });

  it('submits a DMG as it is, naming the keychain when there is one', () => {
    const fake = fakeRun();
    notarizeAndStaple('/r/Taalcut-1.0.0-arm64.dmg', { profile: 'p', keychain: '/k' }, fake.run, () => {});
    expect(fake.calls[0]?.slice(4, 8)).toEqual(['--keychain-profile', 'p', '--keychain', '/k']);
    expect(fake.commands()).toEqual(['xcrun notarytool submit', 'xcrun stapler staple']);
    expect(fake.calls.map((call) => call[3])).toEqual([
      '/r/Taalcut-1.0.0-arm64.dmg',
      '/r/Taalcut-1.0.0-arm64.dmg',
    ]);
  });

  it("fails with Apple's log when the submission is not accepted, and never staples", () => {
    const invalid = { status: 1, stdout: JSON.stringify({ id: 'sub-2', status: 'Invalid' }), stderr: '' };
    const fake = fakeRun(invalid);
    expect(() => notarizeAndStaple('/r/Taalcut.dmg', { profile: 'p' }, fake.run, () => {})).toThrow(
      /notarisation of Taalcut\.dmg failed: Invalid\n.*not signed/s,
    );
    expect(fake.commands()).toEqual(['xcrun notarytool submit', 'xcrun notarytool log']);
  });
});

describe('createDistributionHooks', () => {
  it('notarises the app after signing, and signs then notarises the DMG', async () => {
    const fake = fakeRun();
    const hooks = createDistributionHooks({
      env: {},
      identity: DEVELOPER_ID,
      flavour: 'release',
      run: fake.run,
      log: () => {},
      profileExists: () => true,
    });
    await hooks.afterSign(context());
    await hooks.afterAllArtifactBuild(artifacts('/r/Taalcut.zip', '/r/Taalcut.dmg'));
    expect(fake.commands()).toEqual([
      'ditto -c -k',
      'xcrun notarytool submit',
      'xcrun stapler staple',
      'codesign --force --sign',
      'xcrun notarytool submit',
      'xcrun stapler staple',
    ]);
    expect(fake.calls[3]).toEqual([
      'codesign',
      '--force',
      '--sign',
      DEVELOPER_ID,
      '--timestamp',
      '/r/Taalcut.dmg',
    ]);
  });

  it('without a profile, signs the DMG but notarises nothing, and says so once', async () => {
    const fake = fakeRun();
    const log = vi.fn();
    const profileExists = vi.fn(() => false);
    const hooks = createDistributionHooks({
      env: {},
      identity: DEVELOPER_ID,
      flavour: 'release',
      run: fake.run,
      log,
      profileExists,
    });
    await hooks.afterSign(context());
    await hooks.afterAllArtifactBuild(artifacts('/r/Taalcut.dmg'));
    expect(fake.commands()).toEqual(['codesign --force --sign']);
    expect(profileExists).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^notarisation skipped: keychain profile "taalcut-notary" not found/,
    );
  });

  it('leaves ad-hoc builds and other platforms alone', async () => {
    const fake = fakeRun();
    const hooks = createDistributionHooks({
      env: {},
      identity: AD_HOC,
      flavour: 'release',
      run: fake.run,
      log: () => {},
      profileExists: () => true,
    });
    await hooks.afterSign(context());
    await hooks.afterSign(context('linux'));
    expect(await hooks.afterAllArtifactBuild(artifacts('/r/Taalcut.dmg'))).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});
