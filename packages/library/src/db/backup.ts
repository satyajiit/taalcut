// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Backups: consistent copies made with `VACUUM INTO` (safe while the database
 * is open, compacts as it copies), written to a temporary name, fsynced and
 * then renamed, so a crash never leaves a half-written file that looks valid.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { err, ok, type Result } from '@taalcut/core';
import type { SqliteDriver } from '../driver/types';
import { BackupFailed } from '../errors';

export interface BackupInfo {
  readonly path: string;
  /** Milliseconds since the epoch. */
  readonly createdAt: number;
  /** Schema version of the database when it was copied. */
  readonly schemaVersion: number;
  /** Why it was taken, e.g. 'pre-migrate', 'manual'. Lower-case letters, digits and '-'. */
  readonly reason: string;
}

export interface BackupPolicy {
  readonly dir: string;
  /** How many backups to keep; older ones are deleted after each new backup. */
  readonly keep: number;
}

export const DEFAULT_BACKUPS_KEPT = 5;

export function defaultBackupDir(dbPath: string): string {
  return join(dirname(dbPath), 'backups');
}

/** '2026-10-12T18:15:00.123Z' → '20261012T181500123Z' (sorts the same way as the time). */
function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:.]/g, '');
}

function parseStamp(text: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(text);
  if (!m) return Number.NaN;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeReason(reason: string): string {
  const clean = reason
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'manual';
}

function fsyncPath(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Backups of `dbPath` in `dir`, newest first. Ignores unrelated and partial files. */
export function listBackups(dbPath: string, dir: string): BackupInfo[] {
  if (!existsSync(dir)) return [];
  const pattern = new RegExp(
    `^${escapeRegExp(basename(dbPath))}\\.(\\d{8}T\\d{9}Z)\\.v(\\d+)\\.([a-z0-9-]+)\\.bak$`,
  );
  const found: BackupInfo[] = [];
  for (const name of readdirSync(dir)) {
    const m = pattern.exec(name);
    if (!m) continue;
    const createdAt = parseStamp(m[1]!);
    if (Number.isNaN(createdAt)) continue;
    found.push({ path: join(dir, name), createdAt, schemaVersion: Number(m[2]), reason: m[3]! });
  }
  return found.sort((a, b) => b.createdAt - a.createdAt || b.path.localeCompare(a.path));
}

/** Deletes all but the newest `keep` backups. Returns the deleted paths. */
export function pruneBackups(dbPath: string, policy: BackupPolicy): string[] {
  const stale = listBackups(dbPath, policy.dir).slice(Math.max(1, policy.keep));
  for (const backup of stale) rmSync(backup.path, { force: true });
  return stale.map((b) => b.path);
}

/** Copies the open database to a new backup file, then prunes old ones. */
export function createBackup(
  driver: SqliteDriver,
  dbPath: string,
  policy: BackupPolicy,
  options: { reason: string; schemaVersion: number; now: number },
): Result<BackupInfo> {
  const reason = sanitizeReason(options.reason);
  try {
    mkdirSync(policy.dir, { recursive: true });
    let createdAt = options.now;
    let target = '';
    // Two backups in the same millisecond get distinct names.
    for (;;) {
      target = join(
        policy.dir,
        `${basename(dbPath)}.${stamp(createdAt)}.v${options.schemaVersion}.${reason}.bak`,
      );
      if (!existsSync(target)) break;
      createdAt += 1;
    }
    const partial = `${target}.partial`;
    rmSync(partial, { force: true });
    driver.exec(`VACUUM INTO '${partial.replace(/'/g, "''")}'`);
    fsyncPath(partial);
    renameSync(partial, target);
    try {
      fsyncPath(policy.dir); // make the rename itself durable
    } catch {
      // Not every file system supports fsync on a directory; the file is already synced.
    }
    pruneBackups(dbPath, policy);
    return ok({ path: target, createdAt, schemaVersion: options.schemaVersion, reason });
  } catch (cause) {
    return err(BackupFailed(undefined, { detail: cause instanceof Error ? cause.message : String(cause) }));
  }
}
