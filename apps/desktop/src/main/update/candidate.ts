// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Anti-rollback (P1-B5 step 1): what a downloaded update must be before it is
 * handed to Squirrel.Mac. The feed's latest-mac.yml is unsigned, so its
 * version can lie; these rules look at the bundle itself:
 *
 *   - its CFBundleShortVersionString is strictly newer than the running app's
 *     (an older, genuinely signed Taalcut labelled as newer is refused)
 *   - its code signature carries the running app's team ID (an app without a
 *     team, i.e. an ad-hoc build, accepts no update at all)
 *
 * Pure; verify-download.ts reads both values from the downloaded zip.
 */
import { defineError, err, ok, type Result } from '@taalcut/core';

/** The downloaded bundle isn't newer than the running app. */
export const UpdateNotNewer = defineError<{ version: string; running: string }>('desktop.update_not_newer');
/** The downloaded bundle isn't signed by the running app's team. */
export const UpdateUntrustedSigner = defineError<{ team: string; expected: string }>(
  'desktop.update_untrusted_signer',
);
/** The download couldn't be unpacked or read, or its signature is invalid. */
export const UpdateUnreadable = defineError('desktop.update_unreadable');
/** The verified copy of the download changed before it could be staged. */
export const UpdateChanged = defineError('desktop.update_changed');

export interface BundleIdentity {
  readonly version: string;
  /** TeamIdentifier of the code signature; undefined for ad-hoc or unsigned code. */
  readonly team: string | undefined;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Semver precedence: negative if a < b, 0 if equal, positive if a > b;
 * undefined if either isn't a version. Build metadata is ignored, and a
 * pre-release sorts before its release (1.0.0-rc.1 < 1.0.0).
 */
export function compareVersions(a: string, b: string): number | undefined {
  const left = SEMVER.exec(a.trim());
  const right = SEMVER.exec(b.trim());
  if (!left || !right) return undefined;
  for (const index of [1, 2, 3]) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference !== 0) return difference;
  }
  return comparePreRelease(left[4], right[4]);
}

function comparePreRelease(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const left = a.split('.');
  const right = b.split('.');
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index];
    const y = right[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const numeric = /^\d+$/;
    if (numeric.test(x) && numeric.test(y)) return Number(x) - Number(y);
    if (numeric.test(x)) return -1;
    if (numeric.test(y)) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Accepts the candidate only if it is strictly newer and signed by the running app's team. */
export function checkCandidate(running: BundleIdentity, candidate: BundleIdentity): Result<BundleIdentity> {
  const order = compareVersions(candidate.version, running.version);
  if (order === undefined || order <= 0) {
    return err(UpdateNotNewer({ version: candidate.version, running: running.version }));
  }
  if (running.team === undefined || candidate.team !== running.team) {
    return err(UpdateUntrustedSigner({ team: candidate.team ?? 'none', expected: running.team ?? 'none' }));
  }
  return ok(candidate);
}
