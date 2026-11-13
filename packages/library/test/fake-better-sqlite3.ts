// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for better-sqlite3 built on node:sqlite, with better-sqlite3's
 * API shape (raw(), `open`, string error codes). It lets the fallback adapter
 * run the full test suite without the native addon.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { BetterSqlite3DatabaseLike, BetterSqlite3StatementLike } from '../src/index';

const NAMES: Record<number, string> = {
  5: 'SQLITE_BUSY',
  11: 'SQLITE_CORRUPT',
  26: 'SQLITE_NOTADB',
  787: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  1555: 'SQLITE_CONSTRAINT_PRIMARYKEY',
  2067: 'SQLITE_CONSTRAINT_UNIQUE',
  275: 'SQLITE_CONSTRAINT_CHECK',
  1299: 'SQLITE_CONSTRAINT_NOTNULL',
};

class SqliteError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SqliteError';
  }
}

function translate<T>(fn: () => T): T {
  try {
    return fn();
  } catch (cause) {
    const e = cause as { errcode?: number; message?: string };
    if (typeof e.errcode !== 'number') throw cause;
    throw new SqliteError(String(e.message), NAMES[e.errcode] ?? `SQLITE_ERROR_${e.errcode}`);
  }
}

type Param = null | number | bigint | string | Uint8Array;

class FakeStatement implements BetterSqlite3StatementLike {
  private rawMode = false;
  constructor(private readonly stmt: StatementSync) {}
  run(...params: unknown[]) {
    const r = translate(() => this.stmt.run(...(params as Param[])));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }
  get(...params: unknown[]) {
    this.stmt.setReturnArrays(this.rawMode);
    return translate(() => this.stmt.get(...(params as Param[])));
  }
  all(...params: unknown[]) {
    this.stmt.setReturnArrays(this.rawMode);
    return translate(() => this.stmt.all(...(params as Param[])));
  }
  raw(toggle = true) {
    this.rawMode = toggle;
    return this;
  }
}

export class FakeBetterSqlite3 implements BetterSqlite3DatabaseLike {
  private readonly db: DatabaseSync;
  constructor(path: string, options: { readonly?: boolean } = {}) {
    this.db = translate(
      () => new DatabaseSync(path, { readOnly: options.readonly ?? false, allowExtension: true }),
    );
  }
  get open() {
    return this.db.isOpen;
  }
  get inTransaction() {
    return this.db.isTransaction;
  }
  prepare(sql: string) {
    return new FakeStatement(translate(() => this.db.prepare(sql)));
  }
  exec(sql: string) {
    translate(() => this.db.exec(sql));
    return this;
  }
  loadExtension(path: string) {
    this.db.loadExtension(path);
    return this;
  }
  close() {
    this.db.close();
    return this;
  }
}
