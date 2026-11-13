// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which pre-migration snapshot the library takes on this launch (P3-B9): when this is a staged update's new
 * version (`pending.json`'s `to`) and the pending file names this library, the library clones itself to
 * `pre-migrate-<from>-<to>.sqlite` before migrating, the copy the update guard restores if `to` fails to start.
 * Any other launch takes none: without a pending update no guard would ever restore it.
 */
import { pendingUpdateSchema, readUpdateFile, type PendingUpdate, type UpdatePaths } from './update-files';

export function preMigrationSnapshotFor(
  paths: Pick<UpdatePaths, 'pending'>,
  runningVersion: string,
  library: string,
): Pick<PendingUpdate, 'from' | 'to'> | undefined {
  const read = readUpdateFile(paths.pending, pendingUpdateSchema);
  // A damaged pending file is launch-check's to drop; nothing would restore a copy taken for it.
  if (!read.ok || !read.value) return undefined;
  const { from, to } = read.value;
  return to === runningVersion && read.value.library === library ? { from, to } : undefined;
}
