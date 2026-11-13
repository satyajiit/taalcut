// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the sqlite-vec extension is on disk. A native library can't load from
 * inside app.asar, so packaging unpacks node_modules/sqlite-vec-* (asarUnpack)
 * and sqliteVecPath() rewrites the path to app.asar.unpacked. Main resolves it
 * once and hands the path to whoever opens the library database (the jobs and
 * agent utility processes, once they open it).
 */
import { existsSync } from 'node:fs';
import { err, ok, type Result } from '@taalcut/core';
import { sqliteVecPath, VectorExtensionUnavailable } from '@taalcut/library';

export function resolveSqliteVec(exists: (path: string) => boolean = existsSync): Result<string> {
  let path: string;
  try {
    path = sqliteVecPath();
  } catch (cause) {
    return err(VectorExtensionUnavailable(undefined, { detail: String(cause) }));
  }
  if (!exists(path)) return err(VectorExtensionUnavailable(undefined, { detail: `missing: ${path}` }));
  return ok(path);
}
