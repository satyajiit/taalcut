// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Loads the signed component manifest the app ships (or downloads), for
 * createComponentManager. Verification (verify.ts) comes before any entry is
 * read, so nothing is downloaded from a manifest that isn't ours. The highest
 * accepted `sequence` is kept in a small state file, so an older signed
 * manifest can't be replayed. Refusals are logged and returned as
 * `jobs.manifest_untrusted` (or `jobs.manifest_invalid` for an unreadable
 * file).
 */
import { readFile } from 'node:fs/promises';
import { err, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { ManifestInvalid, ManifestUntrusted } from '../errors';
import { isErrnoException, writeFileAtomic } from '../fs-util';
import { describeCause } from '../http';
import { TRUSTED_MANIFEST_KEYS, type TrustedKey } from '../trusted-keys';
import { verifySignedManifest, type VerifiedManifest } from './verify';

export interface LoadSignedManifestOptions {
  /** The signed manifest file. */
  readonly path: string;
  /** Where the highest accepted sequence is kept, e.g. `<userData>/components/manifest-state.json`. */
  readonly statePath: string;
  /** True in release builds (`__TAALCUT_FLAVOUR__ === 'release'` in the desktop app). */
  readonly release: boolean;
  /** Default: TRUSTED_MANIFEST_KEYS. */
  readonly trustedKeys?: readonly TrustedKey[];
  readonly now?: () => number;
  /** Where refusals are reported. Default: console.warn. */
  readonly log?: (message: string) => void;
}

export async function loadSignedManifest(options: LoadSignedManifestOptions): AsyncResult<VerifiedManifest> {
  const log = options.log ?? console.warn;
  const result = await load(options, log);
  if (!result.ok) log(`[components] manifest refused: ${describeRefusal(result.error)}`);
  return result;
}

async function load(
  options: LoadSignedManifestOptions,
  log: (message: string) => void,
): AsyncResult<VerifiedManifest> {
  const trustedKeys = options.trustedKeys ?? TRUSTED_MANIFEST_KEYS;
  if (options.release && trustedKeys.some((key) => key.development)) {
    // Before the file is even read: a release build must not run on the development key.
    const detail = 'a release build must not trust the development key';
    return err(ManifestUntrusted({ reason: 'development_key' }, { detail }));
  }
  let json: unknown;
  try {
    json = JSON.parse(await readFile(options.path, 'utf8'));
  } catch (cause) {
    return err(ManifestInvalid(undefined, { detail: `${options.path}: ${describeCause(cause)}` }));
  }
  const lastSequence = await readAcceptedSequence(options.statePath, log);
  const verified = verifySignedManifest(json, {
    trustedKeys,
    release: options.release,
    lastSequence,
    now: (options.now ?? Date.now)(),
  });
  if (!verified.ok) return verified;
  const { sequence, keyId } = verified.value;
  if (lastSequence === undefined || sequence > lastSequence) {
    const state: AcceptedState = { v: 1, sequence, keyId };
    try {
      await writeFileAtomic(options.statePath, `${JSON.stringify(state)}\n`);
    } catch (cause) {
      // The manifest is still good; only the rollback floor didn't move.
      log(`[components] could not record manifest sequence ${sequence}: ${describeCause(cause)}`);
    }
  }
  return verified;
}

interface AcceptedState {
  readonly v: 1;
  readonly sequence: number;
  readonly keyId: string;
}

/**
 * The highest sequence accepted so far, or undefined on first run. A damaged
 * state file is reported and treated as missing: anyone who can damage it can
 * delete it, and refusing every manifest would leave the app with none.
 */
async function readAcceptedSequence(
  path: string,
  log: (message: string) => void,
): Promise<number | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    if (isErrnoException(cause, 'ENOENT')) return undefined;
    log(`[components] manifest state unreadable, starting over: ${describeCause(cause)}`);
    return undefined;
  }
  try {
    const state = JSON.parse(text) as Partial<AcceptedState>;
    if (state.v === 1 && Number.isSafeInteger(state.sequence)) return state.sequence;
  } catch {
    // reported below
  }
  log('[components] manifest state damaged, starting over');
  return undefined;
}

function describeRefusal(error: TaalcutError): string {
  const reason = error.params && 'reason' in error.params ? ` (${String(error.params.reason)})` : '';
  return `${error.code}${reason}${error.detail ? `: ${error.detail}` : ''}`;
}
