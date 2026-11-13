// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Each OS's folder for derived media (ADR 0001; the platform services' mediaCacheRoot slot). Apart from the rest of
 * the services, with nothing but node:os and node:path, so shared/media-cache.ts (which every process and the e2e
 * project load) can ask for it without the probes, the native helper and their build-time constants.
 */
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import type { PlatformName } from './names';

const APP_SUPPORT = `${sep}Application Support${sep}`;

/**
 * macOS: ~/Library/Caches, which Time Machine already skips, not Application Support next to the catalog. A userData
 * outside Application Support (a test's) keeps its cache inside it, so a test never touches the developer's Caches.
 */
export function macMediaCacheRoot(userData: string): string {
  const at = userData.indexOf(APP_SUPPORT);
  if (at < 0) return join(userData, 'media-cache');
  return join(userData.slice(0, at), 'Caches', 'Taalcut');
}

/** An XDG base directory variable: only an absolute path counts (the spec says to ignore a relative one). */
function xdgDir(value: string | undefined, fallback: string): string {
  return value && isAbsolute(value) ? value : fallback;
}

/**
 * Linux: Electron puts userData in $XDG_CONFIG_HOME/Taalcut, which is for settings; derived media goes to
 * $XDG_CACHE_HOME/Taalcut (~/.cache/Taalcut), which backups skip. A userData anywhere else (a test's, one given with
 * --user-data-dir) keeps its cache inside it.
 */
export function xdgMediaCacheRoot(
  userData: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  const config = xdgDir(env.XDG_CONFIG_HOME, join(home, '.config'));
  if (dirname(userData) !== config || basename(userData) === '') return join(userData, 'media-cache');
  return join(xdgDir(env.XDG_CACHE_HOME, join(home, '.cache')), 'Taalcut');
}

/** Each OS's rule. Windows, not yet: %LOCALAPPDATA%\Taalcut once its layout is decided; inside userData until then. */
export const MEDIA_CACHE_ROOTS: Readonly<Record<PlatformName, (userData: string) => string>> = {
  darwin: macMediaCacheRoot,
  linux: (userData) => xdgMediaCacheRoot(userData, process.env, homedir()),
  win32: (userData) => join(userData, 'media-cache'),
};
