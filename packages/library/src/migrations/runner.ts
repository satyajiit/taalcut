// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs migrations up or down to a target version, atomically: every step of a
 * run shares one transaction, so the database ends at the target or stays
 * where it was. Applied versions live in `_migrations` (mirrored in
 * `PRAGMA user_version` for quick inspection with the sqlite3 CLI).
 */
import { createHash } from 'node:crypto';
import { err, ok, type Result, type TaalcutError } from '@taalcut/core';
import type { SqliteDriver } from '../driver/types';
import { MigrationFailed, MigrationMismatch, SchemaTooNew } from '../errors';
import type { AppliedMigration, Migration, MigrationReport } from './types';

export const MIGRATIONS_TABLE = '_migrations';

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)`;

/** Throws if the list is malformed: that is a bug in this package, not a runtime condition. */
export function validateMigrations(migrations: readonly Migration[]): void {
  const names = new Set<string>();
  migrations.forEach((m, i) => {
    if (m.version !== i + 1)
      throw new Error(`Migration ${m.name} has version ${m.version}; expected ${i + 1}`);
    if (!/^[a-z][a-z0-9_]*$/.test(m.name)) throw new Error(`Migration name '${m.name}' must be snake_case`);
    if (names.has(m.name)) throw new Error(`Migration name '${m.name}' is used twice`);
    names.add(m.name);
  });
}

export function migrationChecksum(m: Migration): string {
  return createHash('sha256').update(`${m.up}\n-- down --\n${m.down}`).digest('hex').slice(0, 16);
}

/** The highest applied version, or 0 for a new database. */
export function readSchemaVersion(driver: SqliteDriver): number {
  const table = driver
    .prepare("SELECT 1 AS found FROM sqlite_schema WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (!table) return 0;
  const row = driver.prepare(`SELECT max(version) AS version FROM ${MIGRATIONS_TABLE}`).get();
  return Number(row?.version ?? 0);
}

function detail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Thrown inside the transaction to roll back with a typed error. */
class Abort {
  constructor(readonly error: TaalcutError) {}
}

function checkApplied(driver: SqliteDriver, migrations: readonly Migration[]): number {
  const rows = driver.prepare(`SELECT version, checksum FROM ${MIGRATIONS_TABLE} ORDER BY version`).all();
  rows.forEach((row, i) => {
    const version = Number(row.version);
    if (version !== i + 1) {
      throw new Abort(
        MigrationMismatch({ version }, { detail: `applied versions are not contiguous at ${version}` }),
      );
    }
    const known = migrations[i];
    if (!known) {
      throw new Abort(SchemaTooNew({ version: rows.length, supported: migrations.length }));
    }
    const checksum = String(row.checksum);
    if (migrationChecksum(known) !== checksum && !known.replaces?.includes(checksum)) {
      throw new Abort(
        MigrationMismatch({ version }, { detail: `migration ${known.name} changed after it was applied` }),
      );
    }
  });
  return rows.length;
}

/**
 * Checks the applied migrations against the code without changing anything:
 * the current version, or SchemaTooNew / MigrationMismatch. Run on every open.
 */
export function verifyApplied(driver: SqliteDriver, migrations: readonly Migration[]): Result<number> {
  if (readSchemaVersion(driver) === 0) return ok(0);
  try {
    return ok(checkApplied(driver, migrations));
  } catch (cause) {
    if (cause instanceof Abort) return err(cause.error);
    throw cause;
  }
}

function step(driver: SqliteDriver, m: Migration, direction: 'up' | 'down', now: number): void {
  try {
    if (direction === 'up') {
      driver.exec(m.up);
      m.fill?.(driver);
      driver
        .prepare(`INSERT INTO ${MIGRATIONS_TABLE} (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`)
        .run(m.version, m.name, migrationChecksum(m), now);
    } else {
      driver.exec(m.down);
      driver.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = ?`).run(m.version);
    }
  } catch (cause) {
    throw new Abort(MigrationFailed({ version: m.version, direction }, { detail: detail(cause) }));
  }
}

/**
 * Migrates to `target` (default: the latest). Returns what ran. Errors:
 * SchemaTooNew (database is newer than this app), MigrationMismatch (an
 * applied migration was edited), MigrationFailed (SQL or foreign-key failure;
 * nothing was changed).
 */
export function migrate(
  driver: SqliteDriver,
  migrations: readonly Migration[],
  options: { target?: number; now: number },
): Result<MigrationReport> {
  validateMigrations(migrations);
  const target = options.target ?? migrations.length;
  if (!Number.isInteger(target) || target < 0 || target > migrations.length) {
    throw new Error(`Target version ${target} is outside 0..${migrations.length}`);
  }
  const fkWasOn = Number(driver.prepare('PRAGMA foreign_keys').get()?.foreign_keys ?? 0) === 1;
  // Must be set outside a transaction; checked explicitly before commit instead.
  driver.exec('PRAGMA foreign_keys = OFF');
  try {
    driver.exec('BEGIN IMMEDIATE');
    try {
      driver.exec(CREATE_TABLE);
      const from = checkApplied(driver, migrations);
      const applied: AppliedMigration[] = [];
      if (target > from) {
        for (const m of migrations.slice(from, target)) {
          step(driver, m, 'up', options.now);
          applied.push({ version: m.version, name: m.name, direction: 'up' });
        }
      } else {
        for (const m of migrations.slice(target, from).reverse()) {
          step(driver, m, 'down', options.now);
          applied.push({ version: m.version, name: m.name, direction: 'down' });
        }
      }
      const violations = driver.prepare('PRAGMA foreign_key_check').all();
      if (violations.length > 0) {
        const last = applied.at(-1);
        throw new Abort(
          MigrationFailed(
            { version: last?.version ?? from, direction: last?.direction ?? 'up' },
            { detail: `foreign key violations: ${JSON.stringify(violations.slice(0, 5))}` },
          ),
        );
      }
      driver.exec(`PRAGMA user_version = ${target}`);
      driver.exec('COMMIT');
      return ok({ from, to: target, applied });
    } catch (cause) {
      if (driver.inTransaction) driver.exec('ROLLBACK');
      if (cause instanceof Abort) return err(cause.error);
      throw cause;
    }
  } finally {
    if (fkWasOn) driver.exec('PRAGMA foreign_keys = ON');
  }
}
