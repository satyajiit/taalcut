// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The signing side of `scripts/release.mjs` (docs/release.md, "Signed channel files"): making the key pair once,
 * reading the key from the `release` environment's secret, re-signing a channel whose file didn't change, and
 * signing a local channel file.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { isTestSigningKey, parseSigningKey, publicKeyBase64, testSigningKey } from './manifest-signature.ts';
import type { ReleaseStore } from './release-store.ts';
import { signFile } from './signing-store.ts';
import { channelAssets, type PublicChannel } from './versions.ts';

export const SIGNING_KEY_ENV = 'TAALCUT_UPDATE_SIGNING_KEY';

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The signing key from the environment. Required: an unsigned channel file is refused by every build. The
 * well-known test key signs only folder feeds (`--dir`); GitHub Releases (`--repo`) never get one.
 */
export function signingKeyFrom(env: Env, target: 'repo' | 'dir' | 'file'): KeyObject {
  const text = env[SIGNING_KEY_ENV];
  if (!text?.trim()) {
    throw new Error(
      `${SIGNING_KEY_ENV} is not set: every channel file is signed (docs/release.md, "Signed channel files")`,
    );
  }
  const key = parseSigningKey(text);
  if (target === 'repo' && isTestSigningKey(key)) {
    throw new Error(`${SIGNING_KEY_ENV} is the e2e test key: it never signs a published channel`);
  }
  return key;
}

/**
 * `keygen --out <file>`: a new Ed25519 pair. The private key goes only into a new 0600 file (never printed);
 * the public key, which TAALCUT_UPDATE_PUBLIC_KEY bakes into builds, is returned for printing.
 */
export function keygen(out: string): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(out, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
  return publicKeyBase64(privateKey);
}

/** `test-key`: the e2e key's PEM (test builds only; see testSigningKey). */
export function testKeyPem(): string {
  return testSigningKey().export({ format: 'pem', type: 'pkcs8' }).toString();
}

/** `sign --file <path>`: signs a local `<channel>-mac.yml` and returns the `.sig` path. */
export function signLocalFile(file: string, env: Env, now: () => Date): string {
  return signFile(file, signingKeyFrom(env, 'file'), now());
}

/**
 * `resign --channel <stable|beta>`: a fresh signature for the channel file as it is (signatures run out after 90
 * days; re-sign at least every 60). The file is uploaded again unchanged through `store`, a signingStore, which
 * writes its new `.sig`.
 */
export async function resignChannel(store: ReleaseStore, channel: PublicChannel): Promise<string[]> {
  const files = channelAssets(channel);
  const text = await store.readText(files.tag, files.yml);
  if (text === undefined) throw new Error(`${files.tag} has no ${files.yml}`);
  const work = mkdtempSync(join(tmpdir(), 'taalcut-resign-'));
  try {
    const yml = join(work, files.yml);
    writeFileSync(yml, text);
    await store.upload(files.tag, [yml]);
    return [`${files.tag}/${files.yml}: re-signed`];
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
