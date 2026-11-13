// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The SQLite driver port. Everything in this package talks to SQLite through
 * this interface, so `node:sqlite` (the default) and better-sqlite3 (the
 * fallback for a signed build where `node:sqlite` can't load sqlite-vec) are
 * interchangeable. Both are synchronous; so is this interface.
 */

/** Values SQLite can bind and return. Booleans and undefined are not allowed: map them first. */
export type SqlValue = null | number | bigint | string | Uint8Array;

export type SqlRow = Record<string, SqlValue>;

export interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...params: readonly SqlValue[]): SqliteRunResult;
  /** First row as an object keyed by column name, or undefined. */
  get(...params: readonly SqlValue[]): SqlRow | undefined;
  all(...params: readonly SqlValue[]): SqlRow[];
  /** All rows as arrays of column values, in select order (Drizzle maps these). */
  values(...params: readonly SqlValue[]): SqlValue[][];
}

export type DriverName = 'node:sqlite' | 'better-sqlite3';

export interface SqliteDriver {
  readonly name: DriverName;
  /** File path, or ':memory:'. */
  readonly path: string;
  readonly isOpen: boolean;
  readonly inTransaction: boolean;
  /** Runs one or more statements with no parameters and no result. */
  exec(sql: string): void;
  /** Prepared statements are cached per SQL string, so preparing in a loop is cheap. */
  prepare(sql: string): SqliteStatement;
  /** Loads a native extension. Only works if the driver was opened with `allowExtensions`. */
  loadExtension(path: string): void;
  /** Classifies an error thrown by this driver (or wrapped by Drizzle) so callers can react. */
  describeError(error: unknown): SqliteErrorInfo | undefined;
  close(): void;
}

export interface OpenDriverOptions {
  readonly readOnly?: boolean;
  readonly allowExtensions?: boolean;
}

/** Opens connections for one driver implementation. */
export interface SqliteDriverFactory {
  readonly name: DriverName;
  /** Throws the driver's own error if the file can't be opened. */
  open(path: string, options?: OpenDriverOptions): SqliteDriver;
  /** Same as SqliteDriver.describeError, for errors thrown before a connection exists. */
  describeError(error: unknown): SqliteErrorInfo | undefined;
}

export type SqliteErrorKind =
  'corrupt' | 'busy' | 'unique' | 'foreign_key' | 'constraint' | 'readonly' | 'full' | 'cantopen' | 'other';

export interface SqliteErrorInfo {
  readonly kind: SqliteErrorKind;
  /** SQLite's extended result code where the driver exposes it. */
  readonly code: number | undefined;
  readonly message: string;
}

/** SQLite primary result codes we react to (https://sqlite.org/rescode.html). */
const PRIMARY: Record<number, SqliteErrorKind> = {
  5: 'busy', // SQLITE_BUSY
  6: 'busy', // SQLITE_LOCKED
  8: 'readonly', // SQLITE_READONLY
  11: 'corrupt', // SQLITE_CORRUPT
  13: 'full', // SQLITE_FULL
  14: 'cantopen', // SQLITE_CANTOPEN
  19: 'constraint', // SQLITE_CONSTRAINT
  26: 'corrupt', // SQLITE_NOTADB
};

/** Maps an extended result code to a kind. */
export function kindFromCode(code: number): SqliteErrorKind {
  if (code === 2067 || code === 1555) return 'unique'; // CONSTRAINT_UNIQUE, CONSTRAINT_PRIMARYKEY
  if (code === 787) return 'foreign_key'; // CONSTRAINT_FOREIGNKEY
  return PRIMARY[code & 0xff] ?? 'other';
}

/** Drizzle wraps driver errors in `cause` chains; this finds the innermost one matching `pick`. */
export function findCause<T>(error: unknown, pick: (candidate: unknown) => T | undefined): T | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth++) {
    const found = pick(current);
    if (found !== undefined) return found;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}
