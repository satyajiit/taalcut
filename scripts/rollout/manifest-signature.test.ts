// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './cli.ts';
import { testKeyPem } from './key-commands.ts';
import {
  channelOfFile,
  parseSigningKey,
  publicKeyBase64,
  readSignature,
  signManifest,
  testSigningKey,
  verifyManifest,
} from './manifest-signature.ts';

const YML = 'version: 1.3.0-beta.4\n';
const NOW = new Date('2026-10-15T00:00:00.000Z');
const TEST_PUBLIC = 'bO2drZzwnnMDdvBYs1HBdAELrJ31z8kBnolZ8LyGNsQ=';
const key = testSigningKey();

describe('signing a channel file', () => {
  it('writes the envelope the app checks; the pinned vector is the app test’s too', () => {
    // apps/desktop/test/update-manifest.test.ts verifies exactly this text with the build's test key.
    expect(signManifest(YML, { channel: 'beta', key, now: NOW })).toBe(
      '{"v":1,"channel":"beta","sha256":"7f2a45eea4382a2dd4aee23194a1a1d4d510e8a1046bbe0fffdf68631ac20fb2",' +
        '"signedAt":"2026-10-15T00:00:00.000Z","expires":"2027-01-13T00:00:00.000Z",' +
        '"sig":"MC//7PgYv66j25i7h8O+orNkJ3hemyByIYIBF4O7noVKqbyQAFcGcdY3uAcjSORunkAuPJpnvWBuGPBoN3bHCg=="}\n',
    );
    // packaging/build-settings.ts refuses this public key in a release build.
    expect(publicKeyBase64(key)).toBe(TEST_PUBLIC);
  });

  it('verifies only the same bytes, channel and key, before it runs out', () => {
    const sig = signManifest(YML, { channel: 'beta', key, now: NOW });
    const at = (iso: string) => ({ publicKey: TEST_PUBLIC, channel: 'beta' as const, now: new Date(iso) });
    expect(verifyManifest(YML, sig, at('2026-11-01T00:00:00.000Z'))).toBe(true);
    expect(verifyManifest(`${YML}#`, sig, at('2026-11-01T00:00:00.000Z'))).toBe(false);
    expect(verifyManifest(YML, sig, { ...at('2026-11-01T00:00:00.000Z'), channel: 'latest' })).toBe(false);
    expect(verifyManifest(YML, sig, at('2027-01-13T00:00:00.000Z'))).toBe(false);
    const other = publicKeyBase64(generateKeyPairSync('ed25519').privateKey);
    expect(verifyManifest(YML, sig, { ...at('2026-11-01T00:00:00.000Z'), publicKey: other })).toBe(false);
  });

  it('never dates a new signature before the one it replaces', () => {
    const later = signManifest(YML, { channel: 'beta', key, now: new Date('2026-12-01T00:00:00.000Z') });
    const next = readSignature(signManifest(YML, { channel: 'beta', key, now: NOW, previous: later }));
    expect(next?.signedAt).toBe('2026-12-01T00:00:00.001Z');
    expect(readSignature('{"v":1}')).toBeUndefined();
    expect(() => signManifest(YML, { channel: 'beta', key, now: NOW, validityDays: 0 })).toThrow(/1–365/);
  });

  it('knows the channel files: the four channels, never a history copy', () => {
    expect(channelOfFile('latest-mac.yml')).toBe('latest');
    expect(channelOfFile('beta-mac.yml')).toBe('beta');
    expect(channelOfFile('internal-mac.yml')).toBe('internal');
    expect(channelOfFile('history-1.3.0-mac.yml')).toBeUndefined();
    expect(channelOfFile('nightly-mac.yml')).toBeUndefined();
  });

  it('takes an Ed25519 PKCS#8 key as PEM or base64 DER, and never echoes a bad one', () => {
    const pem = testKeyPem();
    expect(publicKeyBase64(parseSigningKey(pem))).toBe(TEST_PUBLIC);
    const der = key.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    expect(publicKeyBase64(parseSigningKey(der))).toBe(TEST_PUBLIC);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({
      format: 'pem',
      type: 'pkcs8',
    });
    expect(() => parseSigningKey(rsa.toString())).toThrow(/Ed25519/);
    expect(() => parseSigningKey('s3cret-value')).toThrow(/^(?!.*s3cret).*PKCS#8/);
  });
});

describe('the release commands sign every channel file', () => {
  let work: string;
  let root: string;
  const out: string[] = [];
  const err: string[] = [];
  const io = { stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) };
  const env = { TAALCUT_UPDATE_SIGNING_KEY: testKeyPem() };
  let clock = NOW.getTime();
  const now = () => new Date((clock += 1000));

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'taalcut-sign-'));
    root = join(work, 'github');
    out.length = 0;
    err.length = 0;
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  function publish(version: string) {
    const artifacts = join(work, `artifacts-${version}`);
    const notes = join(work, `notes-${version}`);
    mkdirSync(artifacts, { recursive: true });
    mkdirSync(notes, { recursive: true });
    writeFileSync(join(artifacts, `Taalcut-${version}-arm64-mac.zip`), `zip of ${version}`);
    writeFileSync(join(artifacts, `Taalcut-${version}-arm64.dmg`), `dmg of ${version}`);
    writeFileSync(join(notes, 'en.md'), `- ${version}`);
    const base = 'https://github.com/taalcut/taalcut';
    const args = ['--dir', root, '--channel', 'beta', '--version', version, '--artifacts', artifacts];
    return run(
      [
        'publish',
        ...args,
        '--notes',
        notes,
        '--download-base',
        `${base}/releases/download`,
        '--repo-url',
        base,
      ],
      io,
      env,
      now,
    );
  }
  const channelFile = (name: string) => readFileSync(join(root, 'channel-beta', name), 'utf8');
  const signedAt = () => readSignature(channelFile('beta-mac.yml.sig'))?.signedAt ?? '';
  const valid = () =>
    verifyManifest(channelFile('beta-mac.yml'), channelFile('beta-mac.yml.sig'), {
      publicKey: TEST_PUBLIC,
      channel: 'beta',
      now: new Date(clock),
    });

  it('signs on publish, promote, pull and resign, each signature newer than the last', async () => {
    expect(await publish('2.0.0-beta.1')).toBe(0);
    expect(valid()).toBe(true);
    expect(existsSync(join(root, 'channel-beta', 'history-2.0.0-beta.1-mac.yml.sig'))).toBe(false);
    const stamps = [signedAt()];
    expect(await publish('2.0.0-beta.2')).toBe(0);
    stamps.push(signedAt());
    const channel = ['--dir', root, '--channel', 'beta'];
    expect(
      await run(['promote', ...channel, '--version', '2.0.0-beta.2', '--stage', '50'], io, env, now),
    ).toBe(0);
    stamps.push(signedAt());
    const pull = ['--bad-version', '2.0.0-beta.2', '--to-version', '2.0.0-beta.1', '--reason', 'broke'];
    expect(await run(['pull', ...channel, ...pull], io, env, now)).toBe(0);
    stamps.push(signedAt());
    const before = channelFile('beta-mac.yml');
    expect(await run(['resign', ...channel], io, env, now)).toBe(0);
    stamps.push(signedAt());
    expect(channelFile('beta-mac.yml')).toBe(before);
    expect(valid()).toBe(true);
    expect([...stamps].sort()).toEqual(stamps);
    expect(new Set(stamps).size).toBe(stamps.length);
    expect(err).toEqual([]);
  });

  it('refuses to write a channel file without a key, and never signs GitHub with the test key', async () => {
    expect(await run(['resign', '--dir', root, '--channel', 'beta'], io, {}, now)).toBe(1);
    expect(err.join('')).toMatch(/TAALCUT_UPDATE_SIGNING_KEY is not set/);
    expect(await run(['resign', '--repo', 'taalcut/taalcut', '--channel', 'beta'], io, env, now)).toBe(1);
    expect(err.join('')).toMatch(/e2e test key/);
  });

  it('makes a key pair into a new 0600 file, prints only the public half, and signs a local file', async () => {
    const keyFile = join(work, 'update-signing.pem');
    expect(await run(['keygen', '--out', keyFile], io, {}, now)).toBe(0);
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    const printed = out.join('');
    const publicKey = publicKeyBase64(parseSigningKey(readFileSync(keyFile, 'utf8')));
    expect(printed).toContain(publicKey);
    expect(printed).not.toContain('PRIVATE KEY');
    expect(await run(['keygen', '--out', keyFile], io, {}, now)).toBe(1);

    const yml = join(work, 'alpha-mac.yml');
    writeFileSync(yml, YML);
    const own = { TAALCUT_UPDATE_SIGNING_KEY: readFileSync(keyFile, 'utf8') };
    expect(await run(['sign', '--file', yml], io, own, now)).toBe(0);
    const sig = readFileSync(`${yml}.sig`, 'utf8');
    expect(verifyManifest(YML, sig, { publicKey, channel: 'alpha', now: new Date(clock) })).toBe(true);
    expect(await run(['sign', '--file', join(work, 'notes.yml')], io, own, now)).toBe(1);
  });

  it('prints the e2e test key', async () => {
    expect(await run(['test-key'], io, {}, now)).toBe(0);
    expect(publicKeyBase64(parseSigningKey(out.join('')))).toBe(TEST_PUBLIC);
  });
});

describe('the workflows', () => {
  const workflow = (name: string) =>
    readFileSync(join(import.meta.dirname, '..', '..', '.github', 'workflows', name), 'utf8');

  it('hand the signing key to the one step that runs release.mjs, in the release environment', () => {
    for (const name of ['publish-release.yml', 'promote-release.yml', 'pull-release.yml']) {
      const text = workflow(name);
      expect(
        text.match(/^ +TAALCUT_UPDATE_SIGNING_KEY: \$\{\{ secrets\.TAALCUT_UPDATE_SIGNING_KEY \}\}$/gm),
        name,
      ).toHaveLength(1);
      const step = text.slice(text.indexOf('TAALCUT_UPDATE_SIGNING_KEY'));
      expect(step.indexOf('node scripts/release.mjs'), name).toBeGreaterThan(-1);
      expect(step.slice(0, step.indexOf('node scripts/release.mjs'))).not.toContain('- name:');
    }
  });

  it('bake the public key into release builds from a repository variable', () => {
    expect(workflow('release.yml')).toContain(
      'TAALCUT_UPDATE_PUBLIC_KEY: ${{ vars.TAALCUT_UPDATE_PUBLIC_KEY }}',
    );
  });
});
