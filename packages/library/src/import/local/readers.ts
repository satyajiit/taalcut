// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, toTaalcutError, type AsyncResult, type Result } from '@taalcut/core';
import type { LibraryDatabase } from '../../db/database';
import { ImportVolumeBusy } from './errors';

/** The barrier and readers share a transaction across processes; no new reader can race an accepted eject. */
export function createImportReaderRegistry(db: LibraryDatabase, pid = process.pid) {
  const count = (volume: string): number =>
    Number(
      db.driver
        .prepare(
          `SELECT (
        SELECT COUNT(*) FROM import_volume_readers WHERE volume IN (?, '*')
      ) + (
        SELECT COUNT(*) FROM import_space_reservations WHERE volume = ?
      ) AS count`,
        )
        .get(volume, volume)?.['count'] ?? 0,
    );
  async function ejectVolumes(volumes: readonly string[], eject: () => AsyncResult<void>): AsyncResult<void> {
    const unique = [...new Set(volumes)];
    const acquired = db.transaction(() => {
      if (
        unique.some(
          (volume) =>
            count(volume) ||
            db.driver.prepare('SELECT volume FROM import_volume_barriers WHERE volume = ?').get(volume),
        )
      )
        return false;
      for (const volume of unique)
        db.driver.prepare('INSERT INTO import_volume_barriers (volume, pid) VALUES (?, ?)').run(volume, pid);
      return true;
    });
    if (!acquired) return err(ImportVolumeBusy());
    try {
      return await eject();
    } catch (cause) {
      return err(toTaalcutError(cause));
    } finally {
      for (const volume of unique)
        db.driver.prepare('DELETE FROM import_volume_barriers WHERE volume = ? AND pid = ?').run(volume, pid);
    }
  }
  return {
    acquire(owner: string, volume: string): Result<() => void> {
      return db.transaction(() => {
        if (
          volume === '*'
            ? db.driver.prepare('SELECT volume FROM import_volume_barriers LIMIT 1').get()
            : db.driver.prepare('SELECT volume FROM import_volume_barriers WHERE volume = ?').get(volume)
        )
          return err(ImportVolumeBusy());
        db.driver
          .prepare('INSERT OR REPLACE INTO import_volume_readers (owner, volume, pid) VALUES (?, ?, ?)')
          .run(owner, volume, pid);
        return ok(() => {
          db.driver
            .prepare('DELETE FROM import_volume_readers WHERE owner = ? AND volume = ?')
            .run(owner, volume);
        });
      });
    },
    count,
    eject: (volume: string, eject: () => AsyncResult<void>) => ejectVolumes([volume], eject),
    ejectVolumes,
    releaseOwner(owner: string): void {
      db.driver.prepare('DELETE FROM import_volume_readers WHERE owner = ?').run(owner);
    },
  };
}
