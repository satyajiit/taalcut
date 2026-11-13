// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The small part of semver the registry needs: parse, compare, and match a
 * range. Ranges: '*', '1' (any 1.x.y), '1.2' (any 1.2.y), '1.2.3' (exact),
 * '^1.2.3' and '~1.2.3' (npm meaning).
 */

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-.]+)?$/;

export function parseSemver(version: string): SemVer | undefined {
  const m = SEMVER.exec(version);
  if (!m) return undefined;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4]?.split('.') ?? [],
  };
}

/** Negative if a < b, 0 if equal, positive if a > b. Prereleases sort before their release. */
export function compareSemver(a: SemVer, b: SemVer): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core !== 0) return core;
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** True when `version` is in `range`. An unparsable version or range matches nothing. */
export function satisfies(version: string, range: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  const r = range.trim();
  if (r === '*') return true;
  const partial = /^(\d+)(?:\.(\d+))?$/.exec(r);
  if (partial) {
    return v.major === Number(partial[1]) && (partial[2] === undefined || v.minor === Number(partial[2]));
  }
  const operator = r.startsWith('^') ? '^' : r.startsWith('~') ? '~' : '';
  const base = parseSemver(r.slice(operator.length));
  if (!base) return false;
  const order = compareSemver(v, base);
  if (order < 0) return false;
  if (operator === '') return order === 0;
  if (operator === '~') return v.major === base.major && v.minor === base.minor;
  if (base.major > 0) return v.major === base.major;
  if (base.minor > 0) return v.major === 0 && v.minor === base.minor;
  return v.major === 0 && v.minor === 0 && v.patch === base.patch;
}
