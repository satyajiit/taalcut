// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Per-connection settings applied on every open. See SPEC.md, "Connection settings". */
import type { SqliteDriver } from '../driver/types';

export interface ConnectionSettings {
  /** How long a writer waits for another connection's lock before SQLITE_BUSY. */
  readonly busyTimeoutMs: number;
  /**
   * FULL: every commit fsyncs the WAL, so an acknowledged command survives an
   * OS crash or power loss, not just a process crash (PRD 11: no data loss).
   * The cost is one fsync per transaction; bulk work batches into transactions.
   * NORMAL survives `kill -9` but can lose the last commits on power loss.
   */
  readonly synchronous: 'FULL' | 'NORMAL';
  /** Memory-mapped reads. The vector index scans every vector per query; mmap makes that ~3x faster. */
  readonly mmapSizeBytes: number;
  readonly cacheSizeKiB: number;
}

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  busyTimeoutMs: 5000,
  synchronous: 'FULL',
  mmapSizeBytes: 1024 * 1024 * 1024,
  cacheSizeKiB: 64 * 1024,
};

function int(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

/** Applies the settings. Throws the driver's error (e.g. SQLITE_NOTADB on a corrupt file). */
export function configureConnection(driver: SqliteDriver, settings: ConnectionSettings): void {
  // busy_timeout first, so switching to WAL waits for other connections instead of failing.
  driver.exec(`PRAGMA busy_timeout = ${int('busyTimeoutMs', settings.busyTimeoutMs)}`);
  if (driver.path !== ':memory:') {
    const row = driver.prepare('PRAGMA journal_mode = WAL').get();
    const mode = String(row?.journal_mode ?? '');
    if (mode !== 'wal') throw new Error(`Could not switch to WAL mode (got '${mode}')`);
  }
  driver.exec(`PRAGMA synchronous = ${settings.synchronous === 'NORMAL' ? 'NORMAL' : 'FULL'}`);
  driver.exec('PRAGMA foreign_keys = ON');
  // Functions and virtual tables reached from the schema (views, triggers) must be marked safe.
  driver.exec('PRAGMA trusted_schema = OFF');
  driver.exec('PRAGMA temp_store = MEMORY');
  driver.exec(`PRAGMA cache_size = -${int('cacheSizeKiB', settings.cacheSizeKiB)}`);
  driver.exec(`PRAGMA mmap_size = ${int('mmapSizeBytes', settings.mmapSizeBytes)}`);
  // Keep the WAL file from growing without bound after a large transaction.
  driver.exec('PRAGMA journal_size_limit = 67108864');
}
