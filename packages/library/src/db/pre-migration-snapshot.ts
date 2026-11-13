// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pre-migration snapshot for the update guard (P3-B9, desktop SPEC "Rollback on a failed launch"): before
 * the migrations a new app version brings, the database is checkpointed and cloned (APFS clonefile, a plain copy
 * on a file system without clones) to `pre-migrate-<from>-<to>.sqlite` beside it, named by the app versions. If
 * that version then fails to start, native/taalcut-cli's guard puts the clone back with the old bundle. The last
 * two are kept. Written to a temporary name, fsynced and renamed, so the guard never finds half a copy.
 */
import {
  closeSync,
  constants,
  copyFileSync,
  fsyncSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { err, ok, ValidationError, type Result } from '@taalcut/core';
import type { SqliteDriver } from '../driver/types';
import { BackupFailed } from '../errors';

/** The app versions an update goes between (`pending.json`'s `from` and `to`). */
export interface PreMigrationVersions {
  readonly from: string;
  readonly to: string;
}

export const PRE_MIGRATION_SNAPSHOTS_KEPT = 2;

const PREFIX = 'pre-migrate-';
const SUFFIX = '.sqlite';

/** The guard's rule for a version that names a file: 1–64 of [0-9A-Za-z.+-], no '..', not starting with '.'. */
const isFileVersion = (version: string) =>
  /^[0-9A-Za-z.+-]{1,64}$/.test(version) && !version.includes('..') && !version.startsWith('.');

export function preMigrationSnapshotPath(dbPath: string, versions: PreMigrationVersions): string {
  return join(dirname(dbPath), `${PREFIX}${versions.from}-${versions.to}${SUFFIX}`);
}

function syncFile(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Keeps the newest `keep` snapshots in the folder. */
function prune(folder: string, keep: number): void {
  const snapshots = readdirSync(folder)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .map((name) => ({ path: join(folder, name), at: statSync(join(folder, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const old of snapshots.slice(keep)) rmSync(old.path, { force: true });
}

/** A complete main file: every WAL frame checkpointed in (busy is 0 when no other connection held it back). */
function checkpoint(driver: SqliteDriver): boolean {
  const row = driver.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  return Number(row?.busy ?? 0) === 0;
}

export function takePreMigrationSnapshot(
  driver: SqliteDriver,
  dbPath: string,
  versions: PreMigrationVersions,
  keep = PRE_MIGRATION_SNAPSHOTS_KEPT,
): Result<string> {
  if (!isFileVersion(versions.from) || !isFileVersion(versions.to))
    return err(
      ValidationError(
        { field: 'preMigrationSnapshot' },
        { detail: 'not a version a file can be named after' },
      ),
    );
  const target = preMigrationSnapshotPath(dbPath, versions);
  const temp = `${target}.tmp`;
  try {
    rmSync(temp, { force: true });
    if (checkpoint(driver)) copyFileSync(dbPath, temp, constants.COPYFILE_FICLONE);
    // Another connection kept frames in the WAL: a consistent copy the slow way instead.
    else driver.prepare('VACUUM INTO ?').run(temp);
    syncFile(temp);
    renameSync(temp, target);
    // A clone keeps the original's times; the newest snapshots are kept by when they were taken.
    const now = new Date();
    utimesSync(target, now, now);
    syncFile(dirname(target));
    prune(dirname(target), keep);
    return ok(target);
  } catch (cause) {
    rmSync(temp, { force: true });
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(BackupFailed(undefined, { detail: `pre-migration snapshot ${basename(target)}: ${detail}` }));
  }
}
