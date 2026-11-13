// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a signed channel file offers: its version and the zip's sha512 (base64, as the update library checks it). Read
 * from the verified bytes only, so the update library can be held to them (manifest-gate.ts). The release scripts
 * write one fixed shape (scripts/rollout/channel-yml.ts: one file, its sha512 repeated at the top level), so the
 * reader is strict: one top-level version, and every sha512 line naming the same zip. Anything else is refused.
 */
import { err, ok, type Result } from '@taalcut/core';
import { UpdateManifestUnreadable } from './manifest-errors';
import type { ManifestChannel } from './manifest-envelope';

export interface SignedOffer {
  readonly channel: ManifestChannel;
  readonly version: string;
  /** base64 sha512 of the zip. */
  readonly sha512: string;
}

/** The largest channel file read: release notes in four languages fit in well under this. */
export const MAX_CHANNEL_FILE_BYTES = 256 * 1024;

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA512 = /^[A-Za-z0-9+/]{86}==$/;

/** A YAML scalar as the scripts and electron-builder write it: plain, or single- or double-quoted. */
function scalar(raw: string): string {
  const value = raw.trim();
  const quoted = /^'(.*)'$/.exec(value) ?? /^"(.*)"$/.exec(value);
  return quoted?.[1] ?? value;
}

export function signedOfferOf(yml: string, channel: ManifestChannel): Result<SignedOffer> {
  const refuse = (detail: string) => err(UpdateManifestUnreadable({ channel }, { detail }));
  const versions: string[] = [];
  const hashes = new Set<string>();
  for (const line of yml.split('\n')) {
    const version = /^version:(.*)$/.exec(line);
    if (version?.[1] !== undefined) versions.push(scalar(version[1]));
    const sha512 = /^\s*(?:- )?sha512:(.*)$/.exec(line);
    if (sha512?.[1] !== undefined) hashes.add(scalar(sha512[1]));
  }
  const [version] = versions;
  if (versions.length !== 1 || version === undefined || !VERSION.test(version)) {
    return refuse('the channel file names no single version');
  }
  const [sha512] = hashes;
  if (hashes.size !== 1 || sha512 === undefined || !SHA512.test(sha512)) {
    return refuse('the channel file names no single zip');
  }
  return ok({ channel, version, sha512 });
}
