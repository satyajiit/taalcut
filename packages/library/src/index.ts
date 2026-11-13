// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/library: database driver, schema, migrations, repositories, vector index.
 *
 * This file is the package's only public entry point. Other packages import
 * from '@taalcut/library' and never from a path inside src/. See SPEC.md.
 */

// Driver port and implementations.
export type {
  DriverName,
  OpenDriverOptions,
  SqliteDriver,
  SqliteDriverFactory,
  SqliteErrorInfo,
  SqliteErrorKind,
  SqliteRunResult,
  SqliteStatement,
  SqlRow,
  SqlValue,
} from './driver/types';
export { nodeSqliteDriver } from './driver/node-sqlite';
export {
  betterSqlite3DriverFactory,
  wrapBetterSqlite3,
  type BetterSqlite3Constructor,
  type BetterSqlite3DatabaseLike,
  type BetterSqlite3StatementLike,
} from './driver/better-sqlite3';
export { createOrm, type LibraryOrm } from './orm/session';

// Opening, backups, recovery, migrations.
export { openDatabase, type LibraryDatabase, type MigrationRun, type OpenDatabaseOptions } from './db/open';
export { listBackups, type BackupInfo, type BackupPolicy } from './db/backup';
export type { IntegrityMode } from './db/integrity';
export type { ConnectionSettings } from './db/pragmas';
export type { BackupRestore } from './db/recovery';
export { buildRecoveryReport } from './db/recovery-report';
export type {
  ProjectCommands,
  ReclaimedJob,
  RecoveredCommand,
  RecoveryOptions,
  RecoveryReport,
} from './db/recovery-types';
export { LIBRARY_MIGRATIONS } from './migrations';
export { migrate, readSchemaVersion } from './migrations/runner';
export type { AppliedMigration, Migration, MigrationReport } from './migrations/types';

export * from './errors';
export type { AcknowledgementId, AssetLocationId } from './ids';
export * from './schema';

// Usage and trace read models (the renderer's proposed usage and traces contracts).
export * from './traces/types';

// Chat read model.
export * from './chat/types';
export { toChatHistory } from './chat/history';

// Repositories (synchronous) and core's ports over them (async).
export * from './repositories';
export * from './ports';
export * from './ports/tokens';

// Secrets: redaction on write, and the scan tests and support tools run (P1-F5).
export {
  containsSecret,
  findSecrets,
  isSecretKey,
  redactSecrets,
  redactText,
  SECRET_PATTERNS,
  type SecretFinding,
  type SecretPattern,
} from './secrets/redact';
export {
  scanForSecrets,
  type SecretScanFinding,
  type SecretScanOptions,
  type SecretScanReport,
} from './secrets/scan';

export * from './sources';

// Phase 2 (SPEC.md, "Phase 2"): the asset profile and views (P2-L1), hashing and Wi-Fi import (P2-L2,
// P2-L3), search (P2-L10), the indexing pipeline (P2-L13), stores (P2-T8, P2-X1, P2-X3, P2-M11, P2-X7)
// and projects (P2-X3).
export * from './profile';
export * from './hashing';
export * from './import';
export * from './imports/adapter';
export * from './imports/service';
export * from './imports/router';
export * from './search';
export * from './indexing';
export * from './stores';
export * from './projects';
export * from './stock';
export * from './hub';
export * from './voice';
export * from './generated';
export * from './usage';
export * from './interchange';
// Learning round 1: agent memory (LRN1-MEM).
export * from './memory';
// LIB1-PLACE: places and trips.
export * from './places';
// Learning round 1: style profiles (LRN1-STY).
export * from './profiles';

// Vector index.
export type {
  VectorFilter,
  VectorIndex,
  VectorItem,
  VectorMatch,
  VectorMetadata,
  VectorSearchOptions,
} from './vector/types';
export { asarUnpackedPath, loadSqliteVec, sqliteVecPath, sqliteVecVersion } from './vector/extension';
export { openVectorIndex, type VectorIndexOptions } from './vector/sqlite-vec-index';
// Editor round 1: comments on a timeline (EDT1-CMT).
export * from './comments';
export * from './creation';
export * from './products';
