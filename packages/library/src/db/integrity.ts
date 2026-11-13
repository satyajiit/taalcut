// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Corruption detection on open. */
import type { SqliteDriver } from '../driver/types';

/**
 * quick: `PRAGMA quick_check`, O(file size), skips index-vs-table cross checks.
 * full: `PRAGMA integrity_check`, slower, also checks indexes match their tables.
 */
export type IntegrityMode = 'quick' | 'full' | 'off';

export type IntegrityReport =
  { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

const MAX_PROBLEMS = 20;

/**
 * Runs the check. Returns the problems SQLite reports. Throws the driver's
 * error when the file is too damaged to read at all (SQLITE_NOTADB / CORRUPT);
 * callers treat that as corruption too.
 */
export function checkIntegrity(driver: SqliteDriver, mode: IntegrityMode): IntegrityReport {
  if (mode === 'off') return { ok: true };
  const pragma = mode === 'full' ? 'integrity_check' : 'quick_check';
  const rows = driver.prepare(`PRAGMA ${pragma}(${MAX_PROBLEMS})`).values();
  const problems = rows.map((row) => String(row[0]));
  if (problems.length === 1 && problems[0] === 'ok') return { ok: true };
  return { ok: false, problems };
}
