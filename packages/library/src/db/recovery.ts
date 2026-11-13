// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Restoring the database from its newest healthy backup, when the file is
 * corrupt or missing. The replacement is copied, checked and fsynced before
 * the live file is touched; the corrupt file (and its -wal/-shm) is then kept,
 * renamed, so nothing is destroyed: support can still try to salvage it. A
 * crash between the two renames leaves no `library.db`, which the next open
 * restores from the same backups.
 */
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { err, ok, type Result } from '@taalcut/core';
import type { SqliteDriverFactory } from '../driver/types';
import { DatabaseCorrupt } from '../errors';
import { listBackups, type BackupInfo } from './backup';
import { checkIntegrity } from './integrity';

/** What restoring from a backup did; part of the RecoveryReport (recovery-report.ts). */
export interface BackupRestore {
  /** `missing`: there was no database file but there were backups. */
  readonly reason: 'corrupt' | 'missing';
  /** What the integrity check or the failed open reported (developer detail). */
  readonly detail: string;
  /**
   * Where the corrupt file was moved. Its -wal and -shm, if any, sit next to it with the same suffixes.
   * null when nothing was moved (a missing file with no leftover -wal or -shm).
   */
  readonly quarantinedPath: string | null;
  readonly restoredFrom: BackupInfo;
}

const SIDE_FILES = ['', '-wal', '-shm'] as const;

/** Renames whichever of the file, -wal and -shm exist. True if any did. */
function moveSet(from: string, to: string): boolean {
  let moved = false;
  for (const suffix of SIDE_FILES) {
    if (!existsSync(from + suffix)) continue;
    renameSync(from + suffix, to + suffix);
    moved = true;
  }
  return moved;
}

function removeSet(path: string): void {
  for (const suffix of SIDE_FILES) rmSync(path + suffix, { force: true });
}

/** `r+` for a file (Windows needs write access to flush), `r` for a directory. */
function fsyncPath(path: string, flags: 'r' | 'r+'): void {
  const fd = openSync(path, flags);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Makes the renames durable. Best effort: not every platform can fsync a directory. */
function fsyncDir(path: string): void {
  try {
    fsyncPath(path, 'r');
  } catch {
    // Windows can't open a directory for fsync; NTFS journals the rename.
  }
}

/** Copies the backup to `staged`, checks it and fsyncs it. True if the copy is healthy and on disk. */
function stageBackup(backup: BackupInfo, staged: string, openDriver: SqliteDriverFactory): boolean {
  try {
    removeSet(staged);
    copyFileSync(backup.path, staged);
    const driver = openDriver.open(staged);
    let healthy: boolean;
    try {
      healthy = checkIntegrity(driver, 'quick').ok;
    } finally {
      driver.close();
    }
    rmSync(`${staged}-wal`, { force: true });
    rmSync(`${staged}-shm`, { force: true });
    if (healthy) fsyncPath(staged, 'r+');
    return healthy;
  } catch {
    // Unreadable, not a database, or the copy failed (disk full, permissions): try the next one.
    return false;
  }
}

/**
 * Puts the newest healthy backup in place of the database at `dbPath`, moving
 * whatever is there aside first. If no backup is healthy, or the swap fails,
 * the live file is left where it was and DatabaseCorrupt is returned.
 */
export function restoreFromBackup(
  dbPath: string,
  backupDir: string,
  openDriver: SqliteDriverFactory,
  options: { reason: BackupRestore['reason']; detail: string; now: number },
): Result<BackupRestore> {
  const staged = `${dbPath}.restoring`;
  const restoredFrom = listBackups(dbPath, backupDir).find((backup) =>
    stageBackup(backup, staged, openDriver),
  );
  if (!restoredFrom) {
    removeSet(staged);
    return err(
      DatabaseCorrupt({ path: dbPath }, { detail: `${options.detail}; no healthy backup in ${backupDir}` }),
    );
  }
  const quarantine = `${dbPath}.corrupt-${new Date(options.now).toISOString().replace(/[-:.]/g, '')}`;
  let moved: boolean;
  try {
    moved = moveSet(dbPath, quarantine);
    renameSync(staged, dbPath);
  } catch (cause) {
    // Put back what was moved; a file already back at dbPath wins.
    for (const suffix of SIDE_FILES) {
      try {
        if (existsSync(quarantine + suffix) && !existsSync(dbPath + suffix))
          renameSync(quarantine + suffix, dbPath + suffix);
      } catch {
        // Still under the quarantine name: nothing is deleted.
      }
    }
    removeSet(staged);
    const reason = cause instanceof Error ? cause.message : String(cause);
    return err(DatabaseCorrupt({ path: dbPath }, { detail: `${options.detail}; restore failed: ${reason}` }));
  }
  fsyncDir(dirname(dbPath));
  return ok({
    reason: options.reason,
    detail: options.detail,
    quarantinedPath: moved ? quarantine : null,
    restoredFrom,
  });
}
