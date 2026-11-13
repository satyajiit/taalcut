// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Locating and loading the sqlite-vec extension (a native .dylib/.so/.dll).
 * In a packaged app the file must be unpacked from the ASAR (electron-builder
 * `asarUnpack`), because the OS can't load a library from inside an archive.
 */
import { sep } from 'node:path';
import { err, ok, type Result } from '@taalcut/core';
import { getLoadablePath } from 'sqlite-vec';
import type { SqliteDriver } from '../driver/types';
import { VectorExtensionUnavailable } from '../errors';

/** Rewrites a path inside `app.asar` to the `app.asar.unpacked` copy; other paths are unchanged. */
export function asarUnpackedPath(path: string, separator: string = sep): string {
  return path.replace(`${separator}app.asar${separator}`, `${separator}app.asar.unpacked${separator}`);
}

/**
 * Absolute path of the sqlite-vec extension for this platform. Inside an
 * Electron ASAR it points at the `app.asar.unpacked` copy instead. Throws if
 * the platform has no prebuilt extension (sqlite-vec 0.1.9: macOS arm64/x64,
 * Linux arm64/x64, Windows x64; no Windows ARM64).
 */
export function sqliteVecPath(): string {
  return asarUnpackedPath(getLoadablePath());
}

/** sqlite-vec's version if it is loaded into this connection, else undefined. */
export function sqliteVecVersion(driver: SqliteDriver): string | undefined {
  try {
    const row = driver.prepare('SELECT vec_version() AS version').get();
    return row ? String(row.version) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Loads sqlite-vec into a connection opened with `allowExtensions` (or opened
 * by openDatabase with `extensions: [sqliteVecPath()]`, which does this).
 * Returns the version, or VectorExtensionUnavailable with the reason.
 */
export function loadSqliteVec(driver: SqliteDriver, path?: string): Result<string> {
  const loaded = sqliteVecVersion(driver);
  if (loaded) return ok(loaded);
  try {
    driver.loadExtension(path ?? sqliteVecPath());
  } catch (cause) {
    return err(
      VectorExtensionUnavailable(undefined, {
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }
  const version = sqliteVecVersion(driver);
  return version
    ? ok(version)
    : err(VectorExtensionUnavailable(undefined, { detail: 'vec_version() missing after load' }));
}
