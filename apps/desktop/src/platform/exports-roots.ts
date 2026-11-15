// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Each OS's rule for the person's exports folder (FIX-EXPORTNAMES; the owner, 2026-11-15: "the exported dir name
 * is weird also the file names"): `~/Movies/Taalcut/Exports`, beside the library's Originals (ADR 0001, "Where
 * files live"), where finished videos, covers and pro exports land under their own names. Only for the app's own
 * data folder, the one directly inside the OS's folder for apps' data: a run on any other (tests and e2e pass
 * --user-data-dir) keeps its exports inside that folder, so a test never writes into the person's Movies. Like
 * cache-roots.ts, nothing but node:os and node:path, so shared/render-paths.ts (which every process loads) can ask.
 */
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { PlatformName } from './names';

type Env = Readonly<Record<string, string | undefined>>;

/** `<home>/Movies/Taalcut/Exports` when `userData` sits directly in `appData`; else `<userData>/Exports`. */
function exportsUnder(userData: string, appData: string, home: string): string {
  return dirname(userData) === appData
    ? join(home, 'Movies', 'Taalcut', 'Exports')
    : join(userData, 'Exports');
}

export function macExportsRoot(userData: string, home: string): string {
  return exportsUnder(userData, join(home, 'Library', 'Application Support'), home);
}

/** Electron's userData is in $XDG_CONFIG_HOME (an absolute path, as the spec says) or ~/.config. */
export function xdgExportsRoot(userData: string, env: Env, home: string): string {
  const set = env.XDG_CONFIG_HOME;
  return exportsUnder(userData, set && isAbsolute(set) ? set : join(home, '.config'), home);
}

/** Electron's userData is in %APPDATA%. */
export function windowsExportsRoot(userData: string, env: Env, home: string): string {
  return exportsUnder(userData, env.APPDATA || join(home, 'AppData', 'Roaming'), home);
}

export const EXPORTS_ROOTS: Readonly<Record<PlatformName, (userData: string) => string>> = {
  darwin: (userData) => macExportsRoot(userData, homedir()),
  linux: (userData) => xdgExportsRoot(userData, process.env, homedir()),
  win32: (userData) => windowsExportsRoot(userData, process.env, homedir()),
};
