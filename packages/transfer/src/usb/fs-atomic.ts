// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { randomBytes } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** `<file>.<pid>.<12 hex>.tmp`: the writer's pid, so a sweep can tell a dead writer's temp from a live one's. */
const TEMP_NAME = /^.+\.(\d+)\.[0-9a-f]{12}\.tmp$/;

/**
 * A temp name beside `path` that no other write uses. Two writers of one file (a lan process in its exit
 * grace still saving a run the next one is carrying on) each rename their own whole file into place. With
 * one shared `<path>.tmp`, the later open truncated the other's temp, the other's rename moved it into place
 * half written, and the later rename failed with ENOENT.
 */
export function uniqueTemp(path: string): string {
  return `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
}

/**
 * Write, fsync, rename, fsync the directory. Same durability as the import journal. Safe with several
 * writers of one file: the last rename wins and no reader sees a partial file. A write that fails takes its
 * temp file with it.
 */
export async function writeAtomic(path: string, body: string | Uint8Array): Promise<void> {
  const tmp = uniqueTemp(path);
  try {
    const handle = await open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (cause) {
    await rm(tmp, { force: true });
    throw cause;
  }
  await syncDir(dirname(path));
}

/**
 * Removes the temps among `names` (entries of `dir`) whose writer has gone: a process that died mid-write.
 * A live process's temps stay, since it may still rename them. Never throws: what could not be removed is
 * returned with its errno, for the caller to log.
 */
export async function sweepTemps(
  dir: string,
  names: readonly string[],
): Promise<{ readonly file: string; readonly code: string }[]> {
  const kept: { file: string; code: string }[] = [];
  for (const name of names) {
    const pid = TEMP_NAME.exec(name)?.[1];
    if (pid === undefined || isAlive(Number(pid))) continue;
    try {
      await rm(join(dir, name), { force: true });
    } catch (cause) {
      kept.push({ file: name, code: errnoOf(cause) ?? 'unknown' });
    }
  }
  return kept;
}

/** Signal 0 delivers nothing: it only asks whether the pid exists (EPERM: it does, under another user). */
function isAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return errnoOf(cause) === 'EPERM';
  }
}

/** Node's errno code (`ENOENT`, `ENOSPC`…) of a thrown fs error, else null. */
export function errnoOf(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return null;
  return typeof cause.code === 'string' ? cause.code : null;
}

export async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function syncDir(dir: string): Promise<void> {
  const handle = await open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
