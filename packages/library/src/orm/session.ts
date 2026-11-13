// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A thin synchronous Drizzle session over our SqliteDriver port. Drizzle 0.45
 * has no `node:sqlite` driver; its sqlite-proxy is async, which would let other
 * queries interleave inside a transaction. This mirrors Drizzle's own
 * better-sqlite3 session instead, so queries and transactions stay synchronous.
 *
 * Pinned to drizzle-orm 0.45.4: `mapResultRow` is a runtime export Drizzle
 * leaves out of its type declarations. The guard below fails loudly on upgrade.
 */
import * as drizzleRuntime from 'drizzle-orm';
import { entityKind, NoopLogger, fillPlaceholders, sql, type Logger, type Query } from 'drizzle-orm';
import {
  BaseSQLiteDatabase,
  SQLitePreparedQuery,
  SQLiteSession,
  SQLiteSyncDialect,
  SQLiteTransaction,
  type PreparedQueryConfig,
  type SelectedFieldsOrdered,
  type SQLiteExecuteMethod,
  type SQLiteTransactionConfig,
} from 'drizzle-orm/sqlite-core';
import type { SqliteDriver, SqliteRunResult, SqlValue } from '../driver/types';

type MapResultRow = (
  columns: SelectedFieldsOrdered,
  row: unknown[],
  joins?: Record<string, boolean>,
) => unknown;
const mapResultRow = (drizzleRuntime as unknown as { mapResultRow?: MapResultRow }).mapResultRow;
if (typeof mapResultRow !== 'function') {
  throw new Error('drizzle-orm no longer exports mapResultRow; update packages/library/src/orm/session.ts');
}

type EmptySchema = Record<string, never>;
type Config = PreparedQueryConfig & { type: 'sync' };
type CustomMapper = (rows: unknown[][]) => unknown;

class DriverPreparedQuery extends SQLitePreparedQuery<Config> {
  static override readonly [entityKind]: string = 'TaalcutDriverPreparedQuery';

  constructor(
    private readonly driver: SqliteDriver,
    query: Query,
    private readonly logger: Logger,
    private readonly fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    private readonly arrayMode: boolean,
    private readonly customResultMapper: CustomMapper | undefined,
  ) {
    super('sync', executeMethod, query);
  }

  private params(placeholderValues?: Record<string, unknown>): SqlValue[] {
    const params = fillPlaceholders(this.query.params, placeholderValues ?? {}) as SqlValue[];
    this.logger.logQuery(this.query.sql, params);
    return params;
  }

  run(placeholderValues?: Record<string, unknown>): SqliteRunResult {
    return this.driver.prepare(this.query.sql).run(...this.params(placeholderValues));
  }

  all(placeholderValues?: Record<string, unknown>): unknown[] {
    if (!this.fields && !this.customResultMapper) {
      return this.driver.prepare(this.query.sql).all(...this.params(placeholderValues));
    }
    const rows = this.values(placeholderValues);
    if (this.customResultMapper) return this.customResultMapper(rows) as unknown[];
    return rows.map((row) => mapResultRow!(this.fields!, row, this.joins()));
  }

  get(placeholderValues?: Record<string, unknown>): unknown {
    if (!this.fields && !this.customResultMapper) {
      return this.driver.prepare(this.query.sql).get(...this.params(placeholderValues));
    }
    const row = this.values(placeholderValues)[0];
    if (!row) return undefined;
    if (this.customResultMapper) return this.customResultMapper([row]);
    return mapResultRow!(this.fields!, row, this.joins());
  }

  values(placeholderValues?: Record<string, unknown>): unknown[][] {
    return this.driver.prepare(this.query.sql).values(...this.params(placeholderValues));
  }

  /** @internal Drizzle calls this to decide how to map relational queries. */
  isResponseInArrayMode(): boolean {
    return this.arrayMode;
  }

  private joins(): Record<string, boolean> | undefined {
    return (this as unknown as { joinsNotNullableMap?: Record<string, boolean> }).joinsNotNullableMap;
  }
}

export class DriverSession extends SQLiteSession<'sync', SqliteRunResult, EmptySchema, EmptySchema> {
  static override readonly [entityKind]: string = 'TaalcutDriverSession';
  private readonly logger: Logger;

  constructor(
    readonly driver: SqliteDriver,
    private readonly syncDialect: SQLiteSyncDialect,
    options: { logger?: Logger } = {},
  ) {
    super(syncDialect);
    this.logger = options.logger ?? new NoopLogger();
  }

  prepareQuery(
    query: Query,
    fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    isResponseInArrayMode: boolean,
    customResultMapper?: (rows: unknown[][]) => unknown,
  ): DriverPreparedQuery {
    return new DriverPreparedQuery(
      this.driver,
      query,
      this.logger,
      fields,
      executeMethod,
      isResponseInArrayMode,
      customResultMapper,
    );
  }

  /**
   * Runs `fn` in a transaction. If one is already open on this connection
   * (a repository called inside a caller's transaction), it nests as a
   * savepoint instead, so repositories compose.
   */
  override transaction<T>(fn: (tx: DriverTransaction) => T, config: SQLiteTransactionConfig = {}): T {
    if (this.driver.inTransaction) {
      const tx = new DriverTransaction('sync', this.syncDialect, this, undefined, 1);
      return tx.transaction(fn);
    }
    const tx = new DriverTransaction('sync', this.syncDialect, this, undefined);
    this.driver.exec(`BEGIN ${(config.behavior ?? 'deferred').toUpperCase()}`);
    try {
      const result = fn(tx);
      assertSync(result);
      this.driver.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.driver.inTransaction) this.driver.exec('ROLLBACK');
      throw error;
    }
  }
}

export class DriverTransaction extends SQLiteTransaction<'sync', SqliteRunResult, EmptySchema, EmptySchema> {
  static override readonly [entityKind]: string = 'TaalcutDriverTransaction';

  override transaction<T>(fn: (tx: DriverTransaction) => T): T {
    const session = (this as unknown as { session: DriverSession }).session;
    const dialect = (this as unknown as { dialect: SQLiteSyncDialect }).dialect;
    // Names may repeat when a nested call re-enters from the root database; that is
    // safe because SQLite's RELEASE / ROLLBACK TO act on the most recent match (LIFO).
    const name = `tc_sp_${this.nestedIndex + 1}`;
    const tx = new DriverTransaction('sync', dialect, session, undefined, this.nestedIndex + 1);
    session.run(sql.raw(`SAVEPOINT ${name}`));
    try {
      const result = fn(tx);
      assertSync(result);
      session.run(sql.raw(`RELEASE SAVEPOINT ${name}`));
      return result;
    } catch (error) {
      session.run(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`));
      session.run(sql.raw(`RELEASE SAVEPOINT ${name}`));
      throw error;
    }
  }
}

function assertSync(result: unknown): void {
  if (result instanceof Promise) {
    throw new Error(
      'Transactions are synchronous: the callback returned a Promise. Do async work outside it.',
    );
  }
}

export type LibraryOrm = BaseSQLiteDatabase<'sync', SqliteRunResult, EmptySchema>;

/** A Drizzle database over a driver. Use the query builder (`orm.select()...`); relational queries are off. */
export function createOrm(driver: SqliteDriver, options: { logger?: Logger } = {}): LibraryOrm {
  const dialect = new SQLiteSyncDialect();
  const session = new DriverSession(driver, dialect, options);
  return new BaseSQLiteDatabase('sync', dialect, session, undefined);
}
