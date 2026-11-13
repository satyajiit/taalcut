// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The open database, as repositories and ports see it. Types only; openDatabase (open.ts) makes one. */
import type { Result } from '@taalcut/core';
import type { SqliteDriver } from '../driver/types';
import type { MigrationReport } from '../migrations/types';
import type { LibraryOrm } from '../orm/session';
import type { BackupInfo } from './backup';
import type { RecoveryReport } from './recovery-types';

export interface MigrationRun extends MigrationReport {
  /** The backup taken just before, or null for a new database. */
  readonly backup: BackupInfo | null;
}

export interface LibraryDatabase {
  readonly path: string;
  readonly driver: SqliteDriver;
  readonly orm: LibraryOrm;
  readonly clock: () => number;
  /**
   * What happened while opening: the migrations that ran, and what was
   * recovered (a restore from backup, unfinished runs, reclaimed jobs), for
   * the "what was recovered" prompt.
   */
  readonly opened: { readonly migration: MigrationRun | null; readonly recovery: RecoveryReport };
  schemaVersion(): number;
  /**
   * Runs `fn` in one transaction (IMMEDIATE by default: takes the write lock up
   * front, so read-then-write can't fail halfway). Synchronous: no awaits inside.
   * Repository calls inside it join it as savepoints. Throws what `fn` throws.
   */
  transaction<T>(fn: () => T, behavior?: 'deferred' | 'immediate' | 'exclusive'): T;
  backup(reason?: string): Result<BackupInfo>;
  listBackups(): BackupInfo[];
  /** Migrates up or down, backing up first. Used by tests and by support tooling. */
  migrateTo(version: number): Result<MigrationRun | null>;
  close(): void;
}
