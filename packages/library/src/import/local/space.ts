// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { statfsSync } from 'node:fs';
import { err, ok, toTaalcutError, type AsyncResult } from '@taalcut/core';
import type { LibraryDatabase } from '../../db/database';
import { inTransaction } from '../../repositories/shared';
import { ImportSpaceUnavailable } from './errors';

export interface ImportSpaceCoordinator {
  reserve(owner: string, volume: string, destination: string, bytes: number): AsyncResult<void>;
  consume(owner: string, bytes: number): void;
  release(owner: string): void;
  reserved(volume: string): number;
}

/** Shared through SQLite, so LAN, local copies and Photos cannot spend the same free space twice. */
export function createImportSpaceCoordinator(
  db: LibraryDatabase,
  options: {
    readonly freeBytes?: (path: string) => number;
    readonly bufferBytes?: number;
    readonly pid?: number;
  } = {},
): ImportSpaceCoordinator {
  const freeBytes =
    options.freeBytes ??
    ((path) => {
      const space = statfsSync(path);
      return Number(space.bavail) * Number(space.bsize);
    });
  const reserved = (volume: string) =>
    Number(
      db.driver
        .prepare(
          'SELECT COALESCE(SUM(remaining), 0) AS bytes FROM import_space_reservations WHERE volume = ?',
        )
        .get(volume)?.['bytes'] ?? 0,
    );
  return {
    reserved,
    async reserve(owner, volume, destination, bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) return err(ImportSpaceUnavailable());
      try {
        return inTransaction(db, 'import space', () => {
          const available = freeBytes(destination);
          const existing = db.driver
            .prepare('SELECT volume FROM import_space_reservations WHERE owner = ?')
            .get(owner);
          if (existing && existing['volume'] !== volume) return err(ImportSpaceUnavailable());
          if (available - reserved(volume) - (options.bufferBytes ?? 64 * 1024 * 1024) < bytes) {
            return err(ImportSpaceUnavailable());
          }
          db.driver
            .prepare(
              `INSERT INTO import_space_reservations (owner, volume, remaining, updated_at, pid)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner) DO UPDATE SET
            remaining = remaining + excluded.remaining, updated_at = excluded.updated_at, pid = excluded.pid`,
            )
            .run(owner, volume, bytes, db.clock(), options.pid ?? process.pid);
          return ok(undefined);
        });
      } catch (cause) {
        return err(toTaalcutError(cause));
      }
    },
    consume(owner, bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid consumed byte count');
      db.driver
        .prepare(
          'UPDATE import_space_reservations SET remaining = MAX(0, remaining - ?), updated_at = ? WHERE owner = ?',
        )
        .run(bytes, db.clock(), owner);
    },
    release(owner) {
      db.driver.prepare('DELETE FROM import_space_reservations WHERE owner = ?').run(owner);
    },
  };
}
