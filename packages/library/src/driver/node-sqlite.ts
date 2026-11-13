// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The default driver: `node:sqlite` (DatabaseSync), built into Node 24 and
 * Electron 44. It loads extensions without a native addon rebuild, which is
 * why it is preferred over better-sqlite3 (PRD 6.4, "Database").
 */
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { bindParams, StatementCache } from './shared';
import {
  findCause,
  kindFromCode,
  type OpenDriverOptions,
  type SqlRow,
  type SqliteDriver,
  type SqliteDriverFactory,
  type SqliteErrorInfo,
  type SqliteRunResult,
  type SqliteStatement,
  type SqlValue,
} from './types';

const bind = (params: readonly SqlValue[]): SQLInputValue[] => bindParams(params);

class NodeStatement implements SqliteStatement {
  constructor(private readonly stmt: StatementSync) {}

  run(...params: readonly SqlValue[]): SqliteRunResult {
    const { changes, lastInsertRowid } = this.stmt.run(...bind(params));
    return { changes: Number(changes), lastInsertRowid };
  }

  get(...params: readonly SqlValue[]): SqlRow | undefined {
    return this.stmt.get(...bind(params)) as SqlRow | undefined;
  }

  all(...params: readonly SqlValue[]): SqlRow[] {
    return this.stmt.all(...bind(params)) as SqlRow[];
  }

  values(...params: readonly SqlValue[]): SqlValue[][] {
    this.stmt.setReturnArrays(true);
    try {
      return this.stmt.all(...bind(params)) as unknown as SqlValue[][];
    } finally {
      this.stmt.setReturnArrays(false);
    }
  }
}

class NodeSqliteDriver implements SqliteDriver {
  readonly name = 'node:sqlite' as const;
  private readonly statements = new StatementCache<NodeStatement>();

  constructor(
    private readonly db: DatabaseSync,
    readonly path: string,
  ) {}

  get isOpen(): boolean {
    return this.db.isOpen;
  }

  get inTransaction(): boolean {
    return this.db.isTransaction;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    return this.statements.getOrCreate(sql, (text) => new NodeStatement(this.db.prepare(text)));
  }

  loadExtension(path: string): void {
    this.db.loadExtension(path);
  }

  describeError(error: unknown): SqliteErrorInfo | undefined {
    return describeNodeSqliteError(error);
  }

  close(): void {
    this.statements.clear();
    if (this.db.isOpen) this.db.close();
  }
}

export function describeNodeSqliteError(error: unknown): SqliteErrorInfo | undefined {
  return findCause(error, (candidate) => {
    const e = candidate as { code?: unknown; errcode?: unknown; message?: unknown };
    if (e.code !== 'ERR_SQLITE_ERROR' || typeof e.errcode !== 'number') return undefined;
    return { kind: kindFromCode(e.errcode), code: e.errcode, message: String(e.message) };
  });
}

/** Opens a `node:sqlite` connection. Throws if the file can't be opened. */
export function openNodeSqlite(path: string, options: OpenDriverOptions = {}): SqliteDriver {
  const db = new DatabaseSync(path, {
    readOnly: options.readOnly ?? false,
    allowExtension: options.allowExtensions ?? false,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  // SQLITE_DBCONFIG_DEFENSIVE: no writable_schema tricks that could corrupt the file.
  db.enableDefensive(true);
  return new NodeSqliteDriver(db, path);
}

/** The default driver factory. */
export const nodeSqliteDriver: SqliteDriverFactory = {
  name: 'node:sqlite',
  open: openNodeSqlite,
  describeError: describeNodeSqliteError,
};
