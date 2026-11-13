// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fallback driver over better-sqlite3, for the case where `node:sqlite` can't
 * load sqlite-vec in the signed, hardened build (plan risk table, P1-D4).
 *
 * better-sqlite3 is not a dependency: it needs a native rebuild for Electron,
 * so apps/desktop installs it only if the fallback is needed and passes its
 * constructor in. The types below are the structural subset we use.
 */
import { bindParams, StatementCache } from './shared';
import {
  findCause,
  type OpenDriverOptions,
  type SqlRow,
  type SqliteDriver,
  type SqliteDriverFactory,
  type SqliteErrorInfo,
  type SqliteErrorKind,
  type SqliteRunResult,
  type SqliteStatement,
  type SqlValue,
} from './types';

export interface BetterSqlite3StatementLike {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  raw(toggle?: boolean): BetterSqlite3StatementLike;
}

export interface BetterSqlite3DatabaseLike {
  readonly open: boolean;
  readonly inTransaction: boolean;
  prepare(sql: string): BetterSqlite3StatementLike;
  exec(sql: string): unknown;
  loadExtension(path: string): unknown;
  close(): unknown;
}

export type BetterSqlite3Constructor = new (
  path: string,
  options?: { readonly?: boolean },
) => BetterSqlite3DatabaseLike;

class BetterStatement implements SqliteStatement {
  constructor(private readonly stmt: BetterSqlite3StatementLike) {}

  run(...params: readonly SqlValue[]): SqliteRunResult {
    const { changes, lastInsertRowid } = this.stmt.run(...bindParams(params));
    return { changes, lastInsertRowid };
  }

  get(...params: readonly SqlValue[]): SqlRow | undefined {
    return this.stmt.get(...bindParams(params)) as SqlRow | undefined;
  }

  all(...params: readonly SqlValue[]): SqlRow[] {
    return this.stmt.all(...bindParams(params)) as SqlRow[];
  }

  values(...params: readonly SqlValue[]): SqlValue[][] {
    this.stmt.raw(true);
    try {
      return this.stmt.all(...bindParams(params)) as SqlValue[][];
    } finally {
      this.stmt.raw(false);
    }
  }
}

class BetterSqlite3Driver implements SqliteDriver {
  readonly name = 'better-sqlite3' as const;
  private readonly statements = new StatementCache<BetterStatement>();

  constructor(
    private readonly db: BetterSqlite3DatabaseLike,
    readonly path: string,
  ) {}

  get isOpen(): boolean {
    return this.db.open;
  }

  get inTransaction(): boolean {
    return this.db.inTransaction;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    return this.statements.getOrCreate(sql, (text) => new BetterStatement(this.db.prepare(text)));
  }

  loadExtension(path: string): void {
    this.db.loadExtension(path);
  }

  describeError(error: unknown): SqliteErrorInfo | undefined {
    return describeBetterSqlite3Error(error);
  }

  close(): void {
    this.statements.clear();
    if (this.db.open) this.db.close();
  }
}

function kindFromName(code: string): SqliteErrorKind {
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return 'unique';
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return 'foreign_key';
  if (code.startsWith('SQLITE_CONSTRAINT')) return 'constraint';
  if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) return 'busy';
  if (code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB') return 'corrupt';
  if (code.startsWith('SQLITE_READONLY')) return 'readonly';
  if (code.startsWith('SQLITE_CANTOPEN')) return 'cantopen';
  if (code === 'SQLITE_FULL') return 'full';
  return 'other';
}

export function describeBetterSqlite3Error(error: unknown): SqliteErrorInfo | undefined {
  return findCause(error, (candidate) => {
    const e = candidate as { code?: unknown; message?: unknown };
    if (typeof e.code !== 'string' || !e.code.startsWith('SQLITE_')) return undefined;
    return { kind: kindFromName(e.code), code: undefined, message: String(e.message) };
  });
}

/** Wraps an already-open better-sqlite3 database. */
export function wrapBetterSqlite3(db: BetterSqlite3DatabaseLike, path: string): SqliteDriver {
  return new BetterSqlite3Driver(db, path);
}

/**
 * A driver factory over the better-sqlite3 constructor the app passes in:
 *
 *   import Database from 'better-sqlite3';
 *   openDatabase({ path, driverFactory: betterSqlite3DriverFactory(Database) });
 */
export function betterSqlite3DriverFactory(Database: BetterSqlite3Constructor): SqliteDriverFactory {
  return {
    name: 'better-sqlite3',
    open: (path: string, options: OpenDriverOptions = {}) =>
      wrapBetterSqlite3(new Database(path, { readonly: options.readOnly ?? false }), path),
    describeError: describeBetterSqlite3Error,
  };
}
