// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Release versions and what each channel accepts (docs/release.md, "Channels and versions"). */
import { VERSION_PATTERN } from './channel-yml.ts';

export const PUBLIC_CHANNELS = ['stable', 'beta'] as const;
export type PublicChannel = (typeof PUBLIC_CHANNELS)[number];

export function isPublicChannel(value: string): value is PublicChannel {
  return (PUBLIC_CHANNELS as readonly string[]).includes(value);
}

/** Semver precedence for release versions (a pre-release sorts before its release). */
export function compareVersions(a: string, b: string): number {
  if (!VERSION_PATTERN.test(a) || !VERSION_PATTERN.test(b)) throw new Error(`not release versions: ${a}, ${b}`);
  const parse = (value: string) => {
    const [core, pre] = value.split('-');
    const numbers = (core ?? '').split('.').map(Number);
    const [label, n] = pre ? pre.split('.') : [undefined, undefined];
    return { numbers, label, n: n === undefined ? undefined : Number(n) };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.label === undefined || right.label === undefined) {
    return (left.label === undefined ? 1 : 0) - (right.label === undefined ? 1 : 0);
  }
  if (left.label !== right.label) return left.label < right.label ? -1 : 1;
  return (left.n ?? 0) - (right.n ?? 0);
}

/** Stable takes plain versions; beta takes `x.y.z-beta.N`. */
export function checkChannelVersion(channel: PublicChannel, version: string): void {
  if (!VERSION_PATTERN.test(version)) throw new Error(`not a release version: ${version}`);
  const beta = /-beta\.\d+$/.test(version);
  const plain = !version.includes('-');
  if (channel === 'stable' && !plain) throw new Error(`stable takes a plain version, not ${version}`);
  if (channel === 'beta' && !beta) throw new Error(`beta takes x.y.z-beta.N, not ${version}`);
}

/** The channel's fixed release, its yml, and its fixed-name DMG (what the website links to). */
export function channelAssets(channel: PublicChannel) {
  return {
    tag: `channel-${channel}`,
    yml: channel === 'stable' ? 'latest-mac.yml' : 'beta-mac.yml',
    dmg: channel === 'stable' ? 'Taalcut-mac-arm64.dmg' : 'Taalcut-beta-mac-arm64.dmg',
    history: (version: string) => `history-${version}-mac.yml`,
  };
}

/** A versioned release's assets. */
export function versionAssets(version: string) {
  return {
    tag: `v${version}`,
    zip: `Taalcut-${version}-arm64-mac.zip`,
    blockmap: `Taalcut-${version}-arm64-mac.zip.blockmap`,
    dmg: `Taalcut-${version}-arm64.dmg`,
    sums: 'SHA256SUMS',
    notes: (locale: string) => `release-notes-${locale}.md`,
  };
}

export const PULLED_MARK = '(pulled)';
