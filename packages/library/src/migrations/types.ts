// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { SqliteDriver } from '../driver/types';

/**
 * A versioned schema change. Migrations are TypeScript modules holding SQL
 * strings (not .sql files), so they bundle into the app with no file loading
 * from the ASAR.
 *
 * Rules: versions start at 1 and go up by 1. Never edit a migration that has
 * shipped (the runner checks a checksum); add a new one. A bug in `down` alone may
 * be fixed in place by listing the old checksum in `replaces`. `up` and `down` run
 * inside a transaction, so they must not contain VACUUM, BEGIN/COMMIT or
 * PRAGMAs that can't run in a transaction. Foreign keys are off while they run
 * and checked before commit, so table rebuilds (SQLite's 12-step ALTER) work.
 */
export interface Migration {
  readonly version: number;
  /** snake_case, e.g. 'phase1_core'. */
  readonly name: string;
  readonly up: string;
  /** Undoes `up` exactly. Data in dropped tables is lost; the pre-migration backup keeps it. */
  readonly down: string;
  /**
   * Values SQL can't compute (migration 24's Unicode name keys), written right after `up` in the same
   * transaction. Not part of the checksum, so never change what a shipped one writes: add a migration.
   */
  readonly fill?: (driver: SqliteDriver) => void;
  /**
   * Checksums of earlier texts of this migration with the same `up` (a fixed `down`). A database that
   * applied one of them still verifies; it runs the current `down`. Never list one whose `up` differed.
   */
  readonly replaces?: readonly string[];
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly direction: 'up' | 'down';
}

export interface MigrationReport {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly AppliedMigration[];
}
