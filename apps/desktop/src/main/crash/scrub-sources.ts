// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the crash scrubber removes besides the keychain's values (P2-X5): the names of this Mac and its
 * account, and the values of environment variables named like credentials. Main reads them once at boot.
 */
import { hostname, userInfo } from 'node:os';

/** `GITHUB_TOKEN`, `OPENAI_API_KEY`, `DB_PASSWORD`, `AWS_SECRET_ACCESS_KEY`, `NPM_AUTH`, `SENTRY_DSN`, … */
const CREDENTIAL_NAME = new RegExp(
  [
    'TOKEN',
    'SECRET',
    'PASS(?:W|PHRASE)',
    'CREDENTIAL',
    'AUTH',
    'COOKIE',
    '(?:^|_)(?:API_?)?KEY(?:$|_)',
    '_PAT$',
    'DSN',
  ].join('|'),
  'i',
);

/** Values of environment variables whose names look like credentials, at least 8 characters long. */
export function environmentSecrets(env: Readonly<Record<string, string | undefined>>): string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && value.length >= 8 && CREDENTIAL_NAME.test(name)) values.add(value);
  }
  return [...values];
}

export interface NameSources {
  readonly userName: () => string;
  readonly hostName: () => string;
}

const SYSTEM: NameSources = {
  userName: () => userInfo().username,
  hostName: () => hostname(),
};

/**
 * The account's user name and the Mac's host name, with and without its `.local` suffix. A source that
 * can't be read (no passwd entry for the account) adds nothing; the home folder is still replaced.
 */
export function machineNames(sources: NameSources = SYSTEM): string[] {
  const names = new Set<string>();
  for (const read of [sources.userName, sources.hostName]) {
    let name: string;
    try {
      name = read().trim();
    } catch (cause) {
      console.warn(`[crash] a name to scrub could not be read: ${String(cause)}`);
      continue;
    }
    if (name.length === 0) continue;
    names.add(name);
    const short = name.replace(/\.local$/i, '');
    if (short !== name) names.add(short);
  }
  return [...names];
}
