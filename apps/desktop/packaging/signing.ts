// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which identity signs the app. CI and contributors sign ad-hoc ("-"), the
 * default. Release builds set TAALCUT_MAC_IDENTITY to the full name of the
 * Developer ID certificate, e.g.
 *   TAALCUT_MAC_IDENTITY="Developer ID Application: Matterward Labs Private Limited (WW382UC8JD)"
 * Nothing is picked from the keychain by itself.
 */
import { execFileSync } from 'node:child_process';

export const AD_HOC = '-';

const DEVELOPER_ID_PREFIX = 'Developer ID Application:';

export function macIdentity(env: NodeJS.ProcessEnv): string {
  return env.TAALCUT_MAC_IDENTITY?.trim() || AD_HOC;
}

/**
 * The identity as electron-builder wants it: without the certificate-type
 * prefix (it refuses one) and it then picks the Developer ID Application
 * certificate with that name. codesign calls of our own keep the full name,
 * because the bare name also matches the team's "Apple Distribution" one.
 */
export function builderIdentity(identity: string): string {
  return identity.startsWith(DEVELOPER_ID_PREFIX)
    ? identity.slice(DEVELOPER_ID_PREFIX.length).trim()
    : identity;
}

/** "Developer ID Application: Name (WW382UC8JD)" → "WW382UC8JD". */
export function teamIdOf(identity: string): string | undefined {
  return /\(([A-Z0-9]{10})\)$/.exec(identity)?.[1];
}

/**
 * codesign arguments for one binary signed outside electron-builder (the
 * sidecars): hardened runtime, and a secure timestamp unless ad-hoc (notary
 * service requirement; an ad-hoc signature can't carry one). No entitlements
 * unless the binary has its own file (the mac helper's).
 */
export function codesignArgs(identity: string, file: string, entitlements?: string): string[] {
  const timestamp = identity === AD_HOC ? [] : ['--timestamp'];
  const own = entitlements === undefined ? [] : ['--entitlements', entitlements];
  return ['--force', '--sign', identity, '--options', 'runtime', ...timestamp, ...own, file];
}

/**
 * Entitlements for the app and its helpers. Ad-hoc builds add
 * disable-library-validation: with hardened runtime, library validation wants
 * every framework signed by the same team, and ad-hoc signatures have no team.
 * See SECURITY.md for why each entitlement is there.
 */
export function entitlementsFile(identity: string): string {
  return identity === AD_HOC ? 'packaging/entitlements.adhoc.plist' : 'packaging/entitlements.mac.plist';
}

/**
 * electron-builder resolves identity "-" by first searching the keychain for
 * an identity whose line *contains* "-", and only then falls back to ad-hoc.
 * Fail instead of letting it pick a real certificate (such as the Developer ID
 * in the PO's keychain) by accident.
 */
export function assertAdHocIsSafe(
  env: NodeJS.ProcessEnv,
  listIdentities: () => string = keychainIdentities,
): void {
  if (env.CSC_LINK || env.CSC_NAME) {
    throw new Error(
      'Ad-hoc build, but CSC_LINK or CSC_NAME is set. Unset them, or set TAALCUT_MAC_IDENTITY.',
    );
  }
  // Lines look like `  1) <40-hex SHA-1> "Developer ID Application: Name (TEAMID)"`.
  const clashes = listIdentities()
    .split('\n')
    .map((line) => line.slice(line.indexOf(')') + 1).trim())
    .filter((line) => /^[0-9A-F]{40} "/.test(line))
    .filter((line) => line.includes(AD_HOC));
  if (clashes.length > 0) {
    throw new Error(
      'A keychain signing identity has "-" in its name, so electron-builder would sign with it instead of ' +
        'ad-hoc. Set TAALCUT_MAC_IDENTITY explicitly, or build on a machine without that identity.',
    );
  }
}

/** electron-builder 26's appleCertificatePrefixes. */
const APPLE_CERTIFICATE_PREFIXES = [
  'Developer ID Application:',
  'Developer ID Installer:',
  '3rd Party Mac Developer Application:',
  '3rd Party Mac Developer Installer:',
];

/** The same two lists electron-builder searches (app-builder-lib codeSign/macCodeSign.js). */
function keychainIdentities(): string {
  const security = (args: string[]) => execFileSync('/usr/bin/security', args, { encoding: 'utf8' });
  const anyPolicy = security(['find-identity', '-v'])
    .split('\n')
    .filter((line) => APPLE_CERTIFICATE_PREFIXES.some((prefix) => line.includes(prefix)));
  return [...anyPolicy, security(['find-identity', '-v', '-p', 'codesigning'])].join('\n');
}
