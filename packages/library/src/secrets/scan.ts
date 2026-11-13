// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The secrets scan (P1-F5): looks for API keys, bearer tokens, OAuth refresh
 * tokens and JWTs in a database file and in log files. For tests and support
 * tooling; it reads everything, so don't run it on the hot path.
 *
 * The database is checked twice: every text value in every table through
 * SQLite (what the app can read back), and the raw bytes of the file and its
 * WAL (which also catch deleted rows still sitting in free pages).
 */
import { existsSync, readFileSync } from 'node:fs';
import { nodeSqliteDriver } from '../driver/node-sqlite';
import type { SqliteDriver, SqliteDriverFactory, SqlRow } from '../driver/types';
import { findSecrets, type SecretFinding } from './redact';

export interface SecretScanOptions {
  /** A database file. It is opened read-only. */
  readonly databasePath?: string;
  readonly logFiles?: readonly string[];
  /** Also scan the raw bytes of the database file and its -wal. Default true. */
  readonly rawBytes?: boolean;
  /** Default: node:sqlite. */
  readonly driver?: SqliteDriverFactory;
}

export interface SecretScanFinding extends SecretFinding {
  /** 'table messages.content (rowid 3)', 'file /path/main.log', 'bytes /path/library.db-wal'. */
  readonly where: string;
}

export interface SecretScanReport {
  readonly findings: readonly SecretScanFinding[];
  /** How many text values and files were read: a scan that read nothing proves nothing. */
  readonly scanned: { readonly values: number; readonly files: number };
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * Every row with its rowid where there is one. Virtual tables whose module
 * isn't loaded here (vec0) can't be read; their shadow tables are ordinary
 * tables, and the byte scan covers them too.
 */
function readRows(db: SqliteDriver, table: string): SqlRow[] {
  for (const sql of [`SELECT rowid AS _rowid_, * FROM ${quote(table)}`, `SELECT * FROM ${quote(table)}`]) {
    try {
      return db.prepare(sql).all();
    } catch {
      // Try the next form.
    }
  }
  return [];
}

function scanTables(path: string, driver: SqliteDriverFactory, found: SecretScanFinding[]): number {
  const db = driver.open(path, { readOnly: true });
  let values = 0;
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
    for (const table of tables) {
      for (const row of readRows(db, table)) {
        for (const [column, value] of Object.entries(row)) {
          if (typeof value !== 'string' || column === '_rowid_') continue;
          values++;
          const rowid = row._rowid_ === undefined ? '' : ` (rowid ${String(row._rowid_)})`;
          for (const f of findSecrets(value)) found.push({ ...f, where: `table ${table}.${column}${rowid}` });
        }
      }
    }
  } finally {
    db.close();
  }
  return values;
}

function scanFile(path: string, label: string, found: SecretScanFinding[]): boolean {
  if (!existsSync(path)) return false;
  // latin1 keeps one character per byte, so binary pages can't hide ASCII tokens.
  const text = readFileSync(path).toString('latin1');
  for (const f of findSecrets(text)) found.push({ ...f, where: `${label} ${path}` });
  return true;
}

export function scanForSecrets(options: SecretScanOptions): SecretScanReport {
  const findings: SecretScanFinding[] = [];
  let values = 0;
  let files = 0;
  if (options.databasePath) {
    values += scanTables(options.databasePath, options.driver ?? nodeSqliteDriver, findings);
    if (options.rawBytes ?? true) {
      for (const suffix of ['', '-wal']) {
        if (scanFile(options.databasePath + suffix, 'bytes', findings)) files++;
      }
    }
  }
  for (const log of options.logFiles ?? []) {
    if (scanFile(log, 'file', findings)) files++;
  }
  return { findings, scanned: { values, files } };
}
