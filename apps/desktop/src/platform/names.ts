// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The OS names the platform services know, and the one read of process.platform in apps/desktop/src
 * (test/platform-branches.test.ts). Dependency-free, so shared/ code can ask for its slot without the rest.
 */
export const PLATFORM_NAMES = ['darwin', 'linux', 'win32'] as const;
export type PlatformName = (typeof PLATFORM_NAMES)[number];

/**
 * The services' name for `platform`. Another Unix (FreeBSD, run from source only) gets Linux's: the same XDG folders
 * and /proc-style mounts are the likeliest fit, and nothing there is shipped.
 */
export function hostPlatformName(platform: string = process.platform): PlatformName {
  return (PLATFORM_NAMES as readonly string[]).includes(platform) ? (platform as PlatformName) : 'linux';
}
