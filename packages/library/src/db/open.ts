// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Opening the library database: connect, configure, check integrity, restore
 * from a backup if the file is corrupt, back up, then migrate. See SPEC.md,
 * "Opening the database".
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { err, ok, type Result } from '@taalcut/core';
import { nodeSqliteDriver } from '../driver/node-sqlite';
import type { SqliteDriver, SqliteDriverFactory } from '../driver/types';
import { BackupFailed, DatabaseCorrupt, DatabaseOpenFailed } from '../errors';
import { LIBRARY_MIGRATIONS } from '../migrations';
import { migrate, readSchemaVersion, verifyApplied } from '../migrations/runner';
import type { Migration } from '../migrations/types';
import { createOrm, type LibraryOrm } from '../orm/session';
import {
  createBackup,
  DEFAULT_BACKUPS_KEPT,
  defaultBackupDir,
  listBackups,
  type BackupInfo,
  type BackupPolicy,
} from './backup';
import { checkIntegrity, type IntegrityMode } from './integrity';
import { takePreMigrationSnapshot, type PreMigrationVersions } from './pre-migration-snapshot';
import { configureConnection, DEFAULT_CONNECTION_SETTINGS, type ConnectionSettings } from './pragmas';
import type { LibraryDatabase, MigrationRun } from './database';
import { restoreFromBackup, type BackupRestore } from './recovery';
import { bareRecoveryReport, buildRecoveryReport } from './recovery-report';
import type { RecoveryOptions, RecoveryReport } from './recovery-types';

export type { LibraryDatabase, MigrationRun } from './database';

export interface OpenDatabaseOptions {
  /** Absolute file path, or ':memory:' (no WAL, no backups, no recovery). */
  readonly path: string;
  /** Default: node:sqlite. */
  readonly driver?: SqliteDriverFactory;
  /** Default: every library migration. */
  readonly migrations?: readonly Migration[];
  /** Default: the latest migration. */
  readonly targetVersion?: number;
  /** Default: `<db dir>/backups`, keep 5. */
  readonly backups?: Partial<BackupPolicy>;
  /** Default: 'quick'. */
  readonly integrityCheck?: IntegrityMode;
  /** Default: 'restore' from the newest healthy backup. */
  readonly onCorruption?: 'restore' | 'fail';
  /** Native extensions loaded into the connection, e.g. `[sqliteVecPath()]`. */
  readonly extensions?: readonly string[];
  readonly connection?: Partial<ConnectionSettings>;
  /** Milliseconds since the epoch. Default: Date.now. */
  readonly clock?: () => number;
  /** What the recovery report reclaims and lists (see RecoveryOptions). */
  readonly recovery?: RecoveryOptions;
  /**
   * P3-B9: this launch is an update from `from` to `to` (the app versions): before migrating, clone the database
   * to `pre-migrate-<from>-<to>.sqlite` beside it for the update guard (pre-migration-snapshot.ts).
   */
  readonly preMigrationSnapshot?: PreMigrationVersions;
}

/** Integrity check failed on an otherwise readable file. */
class CorruptionDetected extends Error {}

interface Resolved {
  readonly path: string;
  readonly factory: SqliteDriverFactory;
  readonly migrations: readonly Migration[];
  readonly policy: BackupPolicy;
  readonly integrity: IntegrityMode;
  readonly extensions: readonly string[];
  readonly settings: ConnectionSettings;
  readonly clock: () => number;
  readonly inMemory: boolean;
  readonly snapshot: PreMigrationVersions | undefined;
}

function resolve(options: OpenDatabaseOptions): Resolved {
  const inMemory = options.path === ':memory:';
  return {
    path: options.path,
    factory: options.driver ?? nodeSqliteDriver,
    migrations: options.migrations ?? LIBRARY_MIGRATIONS,
    policy: {
      // An in-memory database has no directory; backing one up needs an explicit dir.
      dir: options.backups?.dir ?? (inMemory ? '' : defaultBackupDir(options.path)),
      keep: options.backups?.keep ?? DEFAULT_BACKUPS_KEPT,
    },
    integrity: options.integrityCheck ?? 'quick',
    extensions: options.extensions ?? [],
    settings: { ...DEFAULT_CONNECTION_SETTINGS, ...options.connection },
    clock: options.clock ?? Date.now,
    inMemory,
    snapshot: options.preMigrationSnapshot,
  };
}

function connect(r: Resolved): SqliteDriver {
  const driver = r.factory.open(r.path, { allowExtensions: r.extensions.length > 0 });
  try {
    configureConnection(driver, r.settings);
    for (const extension of r.extensions) driver.loadExtension(extension);
    const report = checkIntegrity(driver, r.integrity);
    if (!report.ok) throw new CorruptionDetected(report.problems.join('; '));
    return driver;
  } catch (cause) {
    driver.close();
    throw cause;
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * A missing file with backups next to it was lost (or a restore was cut off between its two renames),
 * not new: put the newest healthy backup back rather than migrate an empty database. With no healthy
 * backup the open goes on and creates a new file, as on first run; the backups are left alone.
 */
function restoreMissing(r: Resolved): BackupRestore | null {
  if (r.inMemory || existsSync(r.path) || listBackups(r.path, r.policy.dir).length === 0) return null;
  const restored = restoreFromBackup(r.path, r.policy.dir, r.factory, {
    reason: 'missing',
    detail: 'the database file was missing',
    now: r.clock(),
  });
  return restored.ok ? restored.value : null;
}

/** Connects, restoring from a backup once if the file is corrupt (or, by default, missing). */
function connectOrRecover(
  r: Resolved,
  onCorruption: 'restore' | 'fail',
): Result<{ driver: SqliteDriver; restored: BackupRestore | null }> {
  try {
    const missing = onCorruption === 'restore' ? restoreMissing(r) : null;
    return ok({ driver: connect(r), restored: missing });
  } catch (cause) {
    const corrupt = cause instanceof CorruptionDetected || r.factory.describeError(cause)?.kind === 'corrupt';
    if (!corrupt) return err(DatabaseOpenFailed({ path: r.path }, { detail: message(cause) }));
    if (r.inMemory || onCorruption === 'fail')
      return err(DatabaseCorrupt({ path: r.path }, { detail: message(cause) }));
    const restored = restoreFromBackup(r.path, r.policy.dir, r.factory, {
      reason: 'corrupt',
      detail: message(cause),
      now: r.clock(),
    });
    if (!restored.ok) return restored;
    try {
      return ok({ driver: connect(r), restored: restored.value });
    } catch (again) {
      return err(
        DatabaseCorrupt({ path: r.path }, { detail: `restored backup failed to open: ${message(again)}` }),
      );
    }
  }
}

function migrateWithBackup(driver: SqliteDriver, r: Resolved, target: number): Result<MigrationRun | null> {
  const verified = verifyApplied(driver, r.migrations);
  if (!verified.ok) return verified;
  const current = verified.value;
  if (current === target) return ok(null);
  // Only for migrations forward from a database that has data: a first run has nothing to roll back to.
  if (r.snapshot && !r.inMemory && current > 0 && current < target) {
    const cloned = takePreMigrationSnapshot(driver, r.path, r.snapshot);
    if (!cloned.ok) return cloned;
  }
  let backup: BackupInfo | null = null;
  if (!r.inMemory && current > 0) {
    const taken = createBackup(driver, r.path, r.policy, {
      reason: `pre-migrate-to-v${target}`,
      schemaVersion: current,
      now: r.clock(),
    });
    if (!taken.ok) return taken;
    backup = taken.value;
  }
  const report = migrate(driver, r.migrations, { target, now: r.clock() });
  return report.ok ? ok({ ...report.value, backup }) : report;
}

class Database implements LibraryDatabase {
  readonly orm: LibraryOrm;
  private openReport: LibraryDatabase['opened'];

  constructor(
    readonly driver: SqliteDriver,
    private readonly r: Resolved,
    opened: LibraryDatabase['opened'],
  ) {
    this.orm = createOrm(driver);
    this.openReport = opened;
  }

  get opened(): LibraryDatabase['opened'] {
    return this.openReport;
  }

  /** Set once by openDatabase: the report needs the open database to build. */
  recovered(report: RecoveryReport): void {
    this.openReport = { ...this.openReport, recovery: report };
  }

  get path(): string {
    return this.r.path;
  }

  get clock(): () => number {
    return this.r.clock;
  }

  schemaVersion(): number {
    return readSchemaVersion(this.driver);
  }

  transaction<T>(fn: () => T, behavior: 'deferred' | 'immediate' | 'exclusive' = 'immediate'): T {
    return this.orm.transaction(() => fn(), { behavior });
  }

  backup(reason = 'manual'): Result<BackupInfo> {
    if (!this.r.policy.dir) return err(BackupFailed(undefined, { detail: 'no backup directory' }));
    return createBackup(this.driver, this.r.path, this.r.policy, {
      reason,
      schemaVersion: this.schemaVersion(),
      now: this.r.clock(),
    });
  }

  listBackups(): BackupInfo[] {
    return listBackups(this.r.path, this.r.policy.dir);
  }

  migrateTo(version: number): Result<MigrationRun | null> {
    return migrateWithBackup(this.driver, this.r, version);
  }

  close(): void {
    if (!this.driver.isOpen) return;
    try {
      this.driver.exec('PRAGMA optimize');
    } catch {
      // Best effort: closing matters more than refreshing planner statistics.
    }
    this.driver.close();
  }
}

/**
 * Opens (creating if needed) the database at `options.path` and migrates it to
 * the target version. Errors: DatabaseOpenFailed, DatabaseCorrupt (no healthy
 * backup), SchemaTooNew, MigrationMismatch, MigrationFailed, BackupFailed.
 */
export function openDatabase(options: OpenDatabaseOptions): Result<LibraryDatabase> {
  const r = resolve(options);
  if (!r.inMemory) {
    try {
      mkdirSync(dirname(r.path), { recursive: true });
    } catch (cause) {
      return err(DatabaseOpenFailed({ path: r.path }, { detail: message(cause) }));
    }
  }
  const connected = connectOrRecover(r, options.onCorruption ?? 'restore');
  if (!connected.ok) return connected;
  const { driver, restored } = connected.value;
  const target = options.targetVersion ?? r.migrations.length;
  const migration = migrateWithBackup(driver, r, target);
  if (!migration.ok) {
    driver.close();
    return migration;
  }
  const db = new Database(driver, r, { migration: migration.value, recovery: bareRecoveryReport(restored) });
  // Only a database at this version's latest schema has the tables the report reads.
  if (r.migrations !== LIBRARY_MIGRATIONS || target !== LIBRARY_MIGRATIONS.length) return ok(db);
  const report = buildRecoveryReport(db, restored, options.recovery);
  if (!report.ok) {
    driver.close();
    return report;
  }
  db.recovered(report.value);
  return ok(db);
}
