// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Signed manifests: pinned keys (current + next, the release key pinned and the
 * development key never), the signature checked before any entry is read,
 * expiry, anti-rollback across restarts, the development key refused by
 * release builds, and every refusal typed and logged. Keys are generated per
 * test run.
 */
import { sign } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Result } from '@taalcut/core';
import {
  canonicalJson,
  DEVELOPMENT_MANIFEST_KEY,
  keyIdOf,
  loadSignedManifest,
  MAX_TRUSTED_KEYS,
  signedMessage,
  TRUSTED_MANIFEST_KEYS,
  type TrustedKey,
  verifySignedManifest,
  type VerifyOptions,
} from '@taalcut/jobs';
import { developmentManifestPrivateKey } from './fixtures/development-manifest-key';
import { tempDir } from './helpers/fixtures';
import { newKey, NOW, payload, signedEnvelope, trustedKeyFor } from './helpers/signing';

const current = newKey();
const next = newKey();
const stranger = newKey();
const trust = [trustedKeyFor(current), trustedKeyFor(next)];

const verifyWith = (json: unknown, overrides: Partial<VerifyOptions> = {}) =>
  verifySignedManifest(json, { trustedKeys: trust, release: true, now: NOW, ...overrides });

const outcome = (result: Result<unknown>) =>
  result.ok
    ? 'accepted'
    : `${result.error.code}${result.error.params?.reason ? `:${result.error.params.reason}` : ''}`;

function tampered() {
  const envelope = signedEnvelope(payload(), current);
  const components = envelope.manifest.components as { artifacts: { sha256: string }[] }[];
  components[0]!.artifacts[0]!.sha256 = 'b'.repeat(64);
  return envelope;
}

describe('verifySignedManifest', () => {
  it('accepts a manifest signed by a pinned key', () => {
    const result = verifyWith(signedEnvelope(payload(), current));
    expect(result).toMatchObject({
      ok: true,
      value: { sequence: 5, notAfter: '2027-04-01T00:00:00Z', keyId: trust[0]!.keyId },
    });
    expect(result.ok && result.value.manifest.components.map((c) => c.id)).toEqual(['parakeet']);
  });

  it('rotates keys: the next key alone, or a stranger beside a pinned key, is accepted', () => {
    expect(verifyWith(signedEnvelope(payload(), next))).toMatchObject({ value: { keyId: trust[1]!.keyId } });
    expect(verifyWith(signedEnvelope(payload(), stranger, current))).toMatchObject({
      value: { keyId: trust[0]!.keyId },
    });
  });

  it.each([
    ['a plain, unsigned manifest', () => payload(), 'unsigned'],
    [
      'a signature by a key this build does not pin',
      () => signedEnvelope(payload(), stranger),
      'unknown_key',
    ],
    ['a payload changed after signing', tampered, 'bad_signature'],
    [
      "a pinned key's id over someone else's signature",
      () => ({
        manifest: payload(),
        signatures: [
          { keyId: trust[0]!.keyId, sig: sign(null, signedMessage(payload()), stranger).toString('base64') },
        ],
      }),
      'bad_signature',
    ],
    [
      'a manifest past its notAfter',
      () => signedEnvelope(payload({ notAfter: '2026-10-01T00:00:00Z' }), current),
      'expired',
    ],
  ])('refuses %s', (_, json, reason) => {
    expect(outcome(verifyWith(json()))).toBe(`jobs.manifest_untrusted:${reason}`);
  });

  it('refuses a sequence lower than the accepted one, and takes the same one again', () => {
    const signed = signedEnvelope(payload({ sequence: 5 }), current);
    expect(outcome(verifyWith(signed, { lastSequence: 6 }))).toBe('jobs.manifest_untrusted:rollback');
    expect(outcome(verifyWith(signed, { lastSequence: 5 }))).toBe('accepted');
  });

  it('checks the signature before reading any entry', () => {
    const envelope = signedEnvelope(payload(), current);
    envelope.manifest = { schemaVersion: 99, components: 'not even a list' };
    expect(outcome(verifyWith(envelope))).toBe('jobs.manifest_untrusted:bad_signature');
    // Correctly signed but not a valid signed manifest: invalid, not untrusted.
    const { sequence: _, ...withoutSequence } = payload();
    expect(outcome(verifyWith(signedEnvelope(withoutSequence, current)))).toBe('jobs.manifest_invalid');
  });

  it('refuses a broken trusted-key list', () => {
    const signed = signedEnvelope(payload(), current);
    const wrongId = { ...trust[0]!, keyId: '0123456789abcdef' };
    for (const trustedKeys of [[], [...trust, trustedKeyFor(stranger)], [wrongId], [trust[0]!, trust[0]!]]) {
      expect(outcome(verifyWith(signed, { trustedKeys }))).toBe('jobs.manifest_untrusted:key_config');
    }
  });

  it('a release build refuses while the development key is pinned; a development build accepts it', () => {
    const signed = signedEnvelope(payload(), developmentManifestPrivateKey());
    const options = { trustedKeys: [DEVELOPMENT_MANIFEST_KEY], now: NOW };
    expect(outcome(verifySignedManifest(signed, { ...options, release: true }))).toBe(
      'jobs.manifest_untrusted:development_key',
    );
    expect(verifySignedManifest(signed, { ...options, release: false })).toMatchObject({
      value: { keyId: DEVELOPMENT_MANIFEST_KEY.keyId },
    });
  });
});

describe('pinned keys', () => {
  it('pins at most two keys, each id matching its public key', () => {
    expect(TRUSTED_MANIFEST_KEYS.length).toBeGreaterThan(0);
    expect(TRUSTED_MANIFEST_KEYS.length).toBeLessThanOrEqual(MAX_TRUSTED_KEYS);
    for (const key of TRUSTED_MANIFEST_KEYS) {
      expect(keyIdOf(Buffer.from(key.publicKey, 'base64url'))).toBe(key.keyId);
    }
  });

  it('marks the development key, whose committed private half matches it', () => {
    expect(DEVELOPMENT_MANIFEST_KEY.development).toBe(true);
    expect(trustedKeyFor(developmentManifestPrivateKey(), true)).toEqual(DEVELOPMENT_MANIFEST_KEY);
  });

  it('pins no development key, so a release build starts the component manager', () => {
    for (const key of TRUSTED_MANIFEST_KEYS) {
      expect(key.development).toBeUndefined();
      expect(key.keyId).not.toBe(DEVELOPMENT_MANIFEST_KEY.keyId);
    }
  });
});

describe('canonical JSON', () => {
  it('sorts keys at every level and has no whitespace, so key order in the file does not matter', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 'x', c: null }], é: true })).toBe(
      '{"a":[{"c":null,"d":"x"}],"b":1,"é":true}',
    );
    const envelope = signedEnvelope(payload(), current);
    const reordered = Object.fromEntries(Object.entries(envelope.manifest).reverse());
    expect(outcome(verifyWith({ ...envelope, manifest: reordered }))).toBe('accepted');
  });

  it('refuses values JSON cannot carry', () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(TypeError);
  });
});

describe('loadSignedManifest', () => {
  let dir: string;
  let path: string;
  let statePath: string;
  let logs: string[];

  beforeEach(async () => {
    dir = await tempDir();
    path = join(dir, 'manifest.signed.json');
    statePath = join(dir, 'manifest-state.json');
    logs = [];
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** `trustedKeys: 'pinned'` leaves the option out, so the loader uses TRUSTED_MANIFEST_KEYS. */
  async function load(
    envelope: unknown,
    overrides: { release?: boolean; trustedKeys?: readonly TrustedKey[] | 'pinned' } = {},
  ) {
    await writeFile(path, JSON.stringify(envelope));
    const trustedKeys = overrides.trustedKeys ?? trust;
    return loadSignedManifest({
      path,
      statePath,
      release: overrides.release ?? true,
      ...(trustedKeys === 'pinned' ? {} : { trustedKeys }),
      now: () => NOW,
      log: (message) => logs.push(message),
    });
  }
  const storedSequence = async () =>
    (JSON.parse(await readFile(statePath, 'utf8')) as { sequence: number }).sequence;

  it('keeps the highest accepted sequence on disk and refuses an older manifest after a restart', async () => {
    expect(outcome(await load(signedEnvelope(payload({ sequence: 5 }), current)))).toBe('accepted');
    expect(await storedSequence()).toBe(5);
    expect(outcome(await load(signedEnvelope(payload({ sequence: 7 }), next)))).toBe('accepted');
    expect(outcome(await load(signedEnvelope(payload({ sequence: 6 }), current)))).toBe(
      'jobs.manifest_untrusted:rollback',
    );
    expect(await storedSequence()).toBe(7);
    expect(outcome(await load(signedEnvelope(payload({ sequence: 7 }), current)))).toBe('accepted');
  });

  it('records the first sequence on an empty userData, creating the state folder', async () => {
    // The desktop's state file is <userData>/components/manifest-state.json; on a first run neither folder exists.
    statePath = join(dir, 'user-data', 'components', 'manifest-state.json');
    expect(outcome(await load(signedEnvelope(payload({ sequence: 2 }), current)))).toBe('accepted');
    expect(logs).toEqual([]);
    expect(await storedSequence()).toBe(2);
    expect(await readdir(join(dir, 'user-data', 'components'))).toEqual(['manifest-state.json']);
    expect(outcome(await load(signedEnvelope(payload({ sequence: 1 }), current)))).toBe(
      'jobs.manifest_untrusted:rollback',
    );
  });

  it('logs every refusal with its code and reason', async () => {
    await load(signedEnvelope(payload(), stranger));
    await load(tampered());
    expect(logs).toEqual([
      expect.stringMatching(/^\[components\] manifest refused: jobs\.manifest_untrusted \(unknown_key\): /),
      expect.stringMatching(/^\[components\] manifest refused: jobs\.manifest_untrusted \(bad_signature\): /),
    ]);
  });

  it('in a release build with the development key pinned, refuses before reading the file', async () => {
    const result = await loadSignedManifest({
      path: join(dir, 'not-there.json'),
      statePath,
      release: true,
      trustedKeys: [DEVELOPMENT_MANIFEST_KEY],
      log: (message) => logs.push(message),
    });
    expect(outcome(result)).toBe('jobs.manifest_untrusted:development_key');
    expect(logs).toHaveLength(1);
  });

  it('in a development build that pins the development key, loads a manifest it signed', async () => {
    const signed = signedEnvelope(payload(), developmentManifestPrivateKey());
    const trustedKeys = [DEVELOPMENT_MANIFEST_KEY];
    expect(outcome(await load(signed, { release: false, trustedKeys }))).toBe('accepted');
  });

  it('by default trusts the pinned keys only: the development key signs nothing a build accepts', async () => {
    const signed = signedEnvelope(payload(), developmentManifestPrivateKey());
    for (const release of [false, true]) {
      expect(outcome(await load(signed, { release, trustedKeys: 'pinned' }))).toBe(
        'jobs.manifest_untrusted:unknown_key',
      );
    }
  });

  it('treats a missing file as invalid, and a damaged state file as a fresh start', async () => {
    const missing = await loadSignedManifest({
      path: join(dir, 'nope.json'),
      statePath,
      release: false,
      log: () => {},
    });
    expect(outcome(missing)).toBe('jobs.manifest_invalid');
    await writeFile(statePath, 'not json');
    expect(outcome(await load(signedEnvelope(payload({ sequence: 2 }), current)))).toBe('accepted');
    expect(logs).toEqual([expect.stringContaining('manifest state damaged')]);
    expect(await storedSequence()).toBe(2);
  });
});
