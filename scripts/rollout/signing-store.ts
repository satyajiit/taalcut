// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every channel file the release scripts upload gets its signature with it (SB-19). Publish, promote, pull and
 * resign all write channel ymls through ReleaseStore.upload, so signing there covers every path, including any
 * added later. A new signature is dated after the one it replaces, so clients that refuse older signatures accept it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { KeyObject } from 'node:crypto';
import { channelOfFile, signManifest, SIGNATURE_SUFFIX } from './manifest-signature.ts';
import type { ReleaseStore } from './release-store.ts';

/** Signs `file` beside itself when it is a channel file; the `.sig` path, or undefined for any other file. */
function writeSignature(
  file: string,
  key: KeyObject,
  now: Date,
  previous: string | undefined,
): string | undefined {
  const channel = channelOfFile(basename(file));
  if (!channel) return undefined;
  const sigFile = `${file}${SIGNATURE_SUFFIX}`;
  writeFileSync(sigFile, signManifest(readFileSync(file), { channel, key, now, previous }));
  return sigFile;
}

export function signingStore(store: ReleaseStore, key: KeyObject, now: () => Date): ReleaseStore {
  return {
    ...store,
    async upload(tag, files) {
      const signatures: string[] = [];
      for (const file of files) {
        const name = basename(file);
        if (!channelOfFile(name)) continue;
        const sig = writeSignature(file, key, now(), await store.readText(tag, `${name}${SIGNATURE_SUFFIX}`));
        if (sig) signatures.push(sig);
      }
      await store.upload(tag, [...files, ...signatures]);
    },
  };
}

/** Signs a local channel file (a team feed's, or the e2e's hand-written ones); returns the `.sig` path. */
export function signFile(file: string, key: KeyObject, now: Date): string {
  let previous: string | undefined;
  try {
    previous = readFileSync(`${file}${SIGNATURE_SUFFIX}`, 'utf8');
  } catch {
    // No earlier signature: the first one.
    previous = undefined;
  }
  const sigFile = writeSignature(file, key, now, previous);
  if (!sigFile)
    throw new Error(`not a channel file (<latest|beta|alpha|internal>-mac.yml): ${basename(file)}`);
  return sigFile;
}
