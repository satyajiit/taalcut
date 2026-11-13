// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Errors this package returns. Each code's i18n key is `errors.<code>`. */
import { defineError, toTaalcutError, type TaalcutError } from '@taalcut/core';
import type { SqliteDriver } from './driver/types';

export const DatabaseOpenFailed = defineError<{ path: string }>('library.database_open_failed');
/** The file is corrupt and no backup passed its integrity check. */
export const DatabaseCorrupt = defineError<{ path: string }>('library.database_corrupt');
export const SchemaTooNew = defineError<{ version: number; supported: number }>('library.schema_too_new');
export const MigrationMismatch = defineError<{ version: number }>('library.migration_mismatch');
export const MigrationFailed = defineError<{ version: number; direction: 'up' | 'down' }>(
  'library.migration_failed',
);
export const BackupFailed = defineError('library.backup_failed', { retryable: true });

/**
 * A row with the same unique key already exists. `name`, when it is one thing
 * people know by name (a source's label): for the message, never a path.
 */
export const Conflict = defineError<{ entity: string; name?: string }>('library.conflict');
/** A foreign key, CHECK or NOT NULL constraint rejected the write. */
export const ConstraintViolation = defineError<{ entity: string }>('library.constraint_violation');
/** The row exists but is not in a state that allows this change (e.g. undoing an undone command). */
export const InvalidState = defineError<{ entity: string; state: string }>('library.invalid_state');
export const DatabaseBusy = defineError('library.database_busy', { retryable: true });
export const DiskFull = defineError('library.disk_full', { retryable: true });
export const QueryFailed = defineError<{ entity: string }>('library.query_failed');
/** Too many command steps have staged writes and not yet been recorded (ports/unit-of-work.ts). */
export const UnitOfWorkFull = defineError<{ limit: number }>('library.unit_of_work_full', {
  retryable: true,
});

/** One artifact is larger than the store takes (createArtifactStore's `maxArtifactBytes`). */
export const ArtifactTooLarge = defineError<{ limit: number }>('library.artifact_too_large');
/** The artifact store has no folder (an in-memory database) or couldn't write its file. */
export const ArtifactsUnavailable = defineError('library.artifacts_unavailable', { retryable: true });

export const VectorExtensionUnavailable = defineError('library.vector_extension_unavailable');
export const VectorIndexMismatch = defineError<{ name: string }>('library.vector_index_mismatch');

/** No key for this provider (Settings → Accounts). Search treats it as providersOff; import of a file does not. */
export const StockNoKey = defineError<{ provider: string }>('library.stock_no_key');
/** The provider's quota, or our own bucket. `retryAfterSeconds` is how long to wait. */
export const StockRateLimited = defineError<{ provider: string; retryAfterSeconds: number }>(
  'library.stock_rate_limited',
  { retryable: true },
);
/** The provider didn't answer with a usable body. Retryable for 429-class and 5xx failures. */
export const StockUnavailable = defineError<{ provider: string }>('library.stock_unavailable', {
  retryable: true,
});
/** NC, ND, ShareAlike, Sampling+ or any raw value not in the licence table. */
export const StockLicenceRefused = defineError<{ licence: string }>('library.stock_licence_refused');
export const StockTooLarge = defineError('library.stock_too_large');
export const StockDownloadFailed = defineError('library.stock_download_failed', { retryable: true });

/** Turns a thrown driver error into a TaalcutError for `entity`. Non-SQLite errors become core.unknown. */
export function fromDriverError(driver: SqliteDriver, error: unknown, entity: string): TaalcutError {
  const info = driver.describeError(error);
  if (!info) return toTaalcutError(error);
  const extras = { detail: info.message };
  switch (info.kind) {
    case 'unique':
      return Conflict({ entity }, extras);
    case 'foreign_key':
    case 'constraint':
      return ConstraintViolation({ entity }, extras);
    case 'busy':
      return DatabaseBusy(undefined, extras);
    case 'full':
      return DiskFull(undefined, extras);
    case 'corrupt':
      return DatabaseCorrupt({ path: driver.path }, extras);
    default:
      return QueryFailed({ entity }, extras);
  }
}
