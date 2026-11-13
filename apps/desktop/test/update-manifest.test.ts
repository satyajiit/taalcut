// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_UPDATE_PUBLIC_KEY } from '../packaging/build-settings';
import { createManifestCheck } from '../src/main/update/manifest-check';
import {
  checkEnvelope,
  manifestChannel,
  manifestKey,
  signedMessage,
  type ManifestChannel,
} from '../src/main/update/manifest-envelope';
import { readFeedFile } from '../src/main/update/manifest-fetch';
import { seenSignatures } from '../src/main/update/manifest-seen';
import { signedOfferOf } from '../src/main/update/manifest-yml';

const SHA = `${'A'.repeat(86)}==`;
const YML = [
  'version: 1.3.0-beta.4',
  'files:',
  "  - url: 'https://github.com/taalcut/taalcut/releases/download/v1.3.0-beta.4/Taalcut-1.3.0-beta.4-arm64-mac.zip'",
  `    sha512: '${SHA}'`,
  '    size: 12',
  "path: 'https://github.com/taalcut/taalcut/releases/download/v1.3.0-beta.4/Taalcut-1.3.0-beta.4-arm64-mac.zip'",
  `sha512: '${SHA}'`,
  "releaseDate: '2026-10-14T10:00:00.000Z'",
  '',
].join('\n');
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const DAY = 86_400_000;

const pair = () => generateKeyPairSync('ed25519');
const signer = pair();
const publicOf = (key: KeyObject) => {
  const x = key.export({ format: 'jwk' }).x ?? '';
  return Buffer.from(x, 'base64url').toString('base64');
};
const trusted = (() => {
  const key = manifestKey(publicOf(signer.publicKey));
  if (!key.ok) throw new Error('bad test key');
  return key.value;
})();

/** A `.sig` as the release scripts write it. */
function envelope(
  yml: string,
  options: { channel?: ManifestChannel; signedAt?: number; days?: number; key?: KeyObject } = {},
): string {
  const signedAt = options.signedAt ?? NOW - DAY;
  const fields = {
    v: 1 as const,
    channel: options.channel ?? 'beta',
    sha256: createHash('sha256').update(yml).digest('hex'),
    signedAt: new Date(signedAt).toISOString(),
    expires: new Date(signedAt + (options.days ?? 90) * DAY).toISOString(),
  };
  const sig = sign(null, Buffer.from(signedMessage(fields)), options.key ?? signer.privateKey).toString(
    'base64',
  );
  return JSON.stringify({ ...fields, sig });
}

const check = (text: string, overrides: Partial<Parameters<typeof checkEnvelope>[0]> = {}) =>
  checkEnvelope({
    envelope: text,
    yml: Buffer.from(YML),
    key: trusted,
    channel: 'beta',
    now: NOW,
    ...overrides,
  });
const codeOf = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);

describe('the channel file signature', () => {
  it('accepts a file signed with the baked key for its channel, and says when it was signed', () => {
    expect(check(envelope(YML))).toEqual({ ok: true, value: { signedAt: NOW - DAY } });
  });

  it('matches the release scripts: their pinned test vector verifies with the test key', () => {
    // scripts/rollout/manifest-signature.test.ts signs this file with testSigningKey() and pins the same text.
    const vector =
      '{"v":1,"channel":"beta","sha256":"7f2a45eea4382a2dd4aee23194a1a1d4d510e8a1046bbe0fffdf68631ac20fb2",' +
      '"signedAt":"2026-10-15T00:00:00.000Z","expires":"2027-01-13T00:00:00.000Z",' +
      '"sig":"MC//7PgYv66j25i7h8O+orNkJ3hemyByIYIBF4O7noVKqbyQAFcGcdY3uAcjSORunkAuPJpnvWBuGPBoN3bHCg=="}';
    const key = manifestKey(TEST_UPDATE_PUBLIC_KEY);
    if (!key.ok) throw new Error('test key');
    const yml = Buffer.from('version: 1.3.0-beta.4\n');
    expect(check(vector, { key: key.value, yml }).ok).toBe(true);
  });

  it('refuses a bad signature, another key and another channel as untrusted', () => {
    const good = JSON.parse(envelope(YML)) as { sig: string };
    const flipped = Buffer.from(good.sig, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(codeOf(check(JSON.stringify({ ...good, sig: flipped.toString('base64') })))).toBe(
      'desktop.update_manifest_untrusted',
    );
    expect(codeOf(check(envelope(YML, { key: pair().privateKey })))).toBe(
      'desktop.update_manifest_untrusted',
    );
    // Beta's file served as stable's (cross-channel replay).
    expect(codeOf(check(envelope(YML), { channel: 'latest' }))).toBe('desktop.update_manifest_untrusted');
  });

  it('refuses bytes other than the signed ones as a mismatch', () => {
    const tampered = Buffer.from(YML.replace('1.3.0-beta.4', '1.3.0-beta.5'));
    expect(codeOf(check(envelope(YML), { yml: tampered }))).toBe('desktop.update_manifest_mismatch');
  });

  it('refuses a signature that ran out, or one older than a file already accepted (a replay)', () => {
    expect(codeOf(check(envelope(YML, { signedAt: NOW - 91 * DAY })))).toBe('desktop.update_manifest_stale');
    expect(codeOf(check(envelope(YML), { lastAccepted: NOW - DAY + 1 }))).toBe(
      'desktop.update_manifest_stale',
    );
    expect(check(envelope(YML), { lastAccepted: NOW - DAY }).ok).toBe(true);
  });

  it('refuses a malformed envelope as unreadable, before believing any field', () => {
    const good = JSON.parse(envelope(YML)) as Record<string, unknown>;
    for (const text of [
      '',
      'not json',
      '[]',
      JSON.stringify({ ...good, extra: 1 }),
      JSON.stringify({ ...good, v: 2 }),
    ]) {
      expect(codeOf(check(text)), text.slice(0, 40)).toBe('desktop.update_manifest_unreadable');
    }
    const { sig: _sig, ...unsigned } = good;
    expect(codeOf(check(JSON.stringify(unsigned)))).toBe('desktop.update_manifest_unreadable');
  });

  it('takes only a 32-byte base64 key, and names the default channel latest', () => {
    expect(manifestKey('').ok).toBe(false);
    expect(manifestKey(Buffer.alloc(31).toString('base64')).ok).toBe(false);
    expect(manifestChannel(undefined)).toBe('latest');
    expect(manifestChannel('beta')).toBe('beta');
    expect(manifestChannel('../beta')).toBeUndefined();
  });
});

describe('what a signed file offers', () => {
  it('reads the version and the zip from the scripts’ shape and electron-builder’s', () => {
    expect(signedOfferOf(YML, 'beta')).toEqual({
      ok: true,
      value: { channel: 'beta', version: '1.3.0-beta.4', sha512: SHA },
    });
    const builder = `version: 0.0.1\nfiles:\n  - url: Taalcut-0.0.1-arm64-mac.zip\n    sha512: ${SHA}\n    size: 9\npath: Taalcut-0.0.1-arm64-mac.zip\nsha512: ${SHA}\n`;
    expect(signedOfferOf(builder, 'latest').ok).toBe(true);
  });

  it('refuses anything that names more or less than one version and one zip', () => {
    const other = `${'B'.repeat(86)}==`;
    for (const yml of [
      YML.replace('version: 1.3.0-beta.4\n', ''),
      `${YML}version: 9.9.9\n`,
      YML.replace(`sha512: '${SHA}'\nreleaseDate`, `sha512: '${other}'\nreleaseDate`),
      YML.replaceAll(SHA, 'short'),
      'version: banana\n',
    ]) {
      expect(signedOfferOf(yml, 'beta').ok).toBe(false);
    }
  });
});

describe('the newest accepted signature per channel', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'taalcut-seen-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps only a newer time, per channel, in a 0600 file', () => {
    const file = join(dir, 'updates', 'manifest-seen.json');
    const seen = seenSignatures(file);
    expect(seen.last('beta')).toBeUndefined();
    seen.accept('beta', 20);
    seen.accept('beta', 10);
    seen.accept('latest', 5);
    expect(seen.last('beta')).toBe(20);
    expect(seen.last('latest')).toBe(5);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ v: 1, channels: { latest: 5, beta: 20 } });
  });

  it('reads a damaged file as empty and says so', () => {
    const file = join(dir, 'manifest-seen.json');
    writeFileSync(file, '{"v":1,"channels":{"beta":"yesterday"}}');
    const lines: string[] = [];
    expect(seenSignatures(file, (line) => lines.push(line)).last('beta')).toBeUndefined();
    expect(lines.join('')).toContain('desktop.update_file_invalid');
  });
});

/** A feed of in-memory files (absent: 404). */
function feedOf(files: Record<string, string | Response>) {
  const requests: string[] = [];
  const fetch = async (url: string) => {
    requests.push(url);
    const file = files[new URL(url).pathname.slice(1)];
    if (file instanceof Response) return file;
    return file === undefined ? new Response('', { status: 404 }) : new Response(file);
  };
  return { fetch, requests };
}

describe('reading feed files', () => {
  const url = new URL('https://feed.example/beta-mac.yml');

  it('reads a file, and says when it is missing or the feed failed', async () => {
    expect(
      await readFeedFile(feedOf({ 'beta-mac.yml': 'x' }).fetch, url, { maxBytes: 10, loopbackHttp: false }),
    ).toEqual({
      kind: 'found',
      bytes: new TextEncoder().encode('x'),
    });
    expect(await readFeedFile(feedOf({}).fetch, url, { maxBytes: 10, loopbackHttp: false })).toEqual({
      kind: 'missing',
    });
    const down = async () => Promise.reject(new Error('offline'));
    expect(await readFeedFile(down, url, { maxBytes: 10, loopbackHttp: false })).toMatchObject({
      kind: 'failed',
    });
  });

  it('stops reading past the cap, declared or not', async () => {
    const big = feedOf({ 'beta-mac.yml': 'x'.repeat(11) }).fetch;
    expect(await readFeedFile(big, url, { maxBytes: 10, loopbackHttp: false })).toMatchObject({
      kind: 'failed',
    });
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 4; i += 1) controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    });
    const undeclared = feedOf({ 'beta-mac.yml': new Response(stream) }).fetch;
    expect(await readFeedFile(undeclared, url, { maxBytes: 10, loopbackHttp: false })).toMatchObject({
      kind: 'failed',
    });
  });

  it('fetches only https, or loopback http for a local test feed', async () => {
    const { fetch, requests } = feedOf({ 'beta-mac.yml': 'x' });
    const plain = new URL('http://feed.example/beta-mac.yml');
    expect(await readFeedFile(fetch, plain, { maxBytes: 10, loopbackHttp: true })).toMatchObject({
      kind: 'failed',
    });
    expect(requests).toEqual([]);
    const local = new URL('http://127.0.0.1:4100/beta-mac.yml');
    expect(await readFeedFile(fetch, local, { maxBytes: 10, loopbackHttp: true })).toMatchObject({
      kind: 'found',
    });
  });
});

describe('the manifest check', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'taalcut-manifest-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (files: Record<string, string>, channel = 'beta') => {
    const seen = seenSignatures(join(dir, 'seen.json'));
    const feed = feedOf(files);
    const checkFeed = createManifestCheck({ fetch: feed.fetch, key: trusted, seen, now: () => NOW });
    return { result: checkFeed('https://feed.example/channel-beta', channel), seen, feed };
  };

  it('fetches the channel file and its signature, and returns the signed offer', async () => {
    const { result, seen, feed } = run({
      'channel-beta/beta-mac.yml': YML,
      'channel-beta/beta-mac.yml.sig': envelope(YML),
    });
    expect(await result).toEqual({
      ok: true,
      value: { channel: 'beta', version: '1.3.0-beta.4', sha512: SHA },
    });
    expect(feed.requests).toEqual([
      'https://feed.example/channel-beta/beta-mac.yml',
      'https://feed.example/channel-beta/beta-mac.yml.sig',
    ]);
    expect(seen.last('beta')).toBe(NOW - DAY);
  });

  it('calls a missing channel file a failed check, and a missing signature a refusal', async () => {
    expect(await run({}).result).toMatchObject({ ok: false, error: { kind: 'failed' } });
    expect(await run({ 'channel-beta/beta-mac.yml': YML }).result).toMatchObject({
      ok: false,
      error: { kind: 'refused', error: { code: 'desktop.update_manifest_missing' } },
    });
  });

  it('refuses a replay and keeps the newer time it had', async () => {
    const files = { 'channel-beta/beta-mac.yml': YML, 'channel-beta/beta-mac.yml.sig': envelope(YML) };
    const first = run(files);
    expect((await first.result).ok).toBe(true);
    first.seen.accept('beta', NOW);
    expect(await run(files).result).toMatchObject({
      ok: false,
      error: { kind: 'refused', error: { code: 'desktop.update_manifest_stale' } },
    });
    expect(first.seen.last('beta')).toBe(NOW);
  });
});
