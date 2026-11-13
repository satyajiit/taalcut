// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The first thing main does (P3-B9): count this launch if it is a freshly installed update, and decide whether
 * to hand over to the rollback guard. Synchronous and Electron-free, so it runs before 'ready' and before the
 * library opens (a broken update may crash in either).
 *
 *   pending.json absent                 nothing to do
 *   running = pending.from              the update hasn't installed yet (or failed to): leave it
 *   running = pending.to, healthy-<to>  a previous launch was healthy: clean up the clone, pending.json, the guard
 *   running = pending.to, no marker     launchAttempts += 1; at ROLLBACK_AFTER_ATTEMPTS start the guard with
 *                                       --rollback-now and quit (no guard is alive: a reboot, or it was killed)
 *   anything else                       a later update replaced it: clean up
 */
import { statSync } from 'node:fs';
import type { TaalcutError } from '@taalcut/core';
import {
  pendingUpdateSchema,
  readUpdateFile,
  removeUpdateFile,
  writeUpdateFile,
  type PendingUpdate,
  type UpdatePaths,
} from './update-files';

/** The guard rolls back after two failed launches it watched; this catches a third with no guard alive. */
export const ROLLBACK_AFTER_ATTEMPTS = 3;

export type LaunchVerdict =
  /** `cleanup`: bundles and folders to remove once the app is up (they may be large). */
  | { readonly kind: 'normal'; readonly cleanup: readonly string[]; readonly problem?: TaalcutError }
  /** A new version's first launches: watch its health (health.ts). */
  | { readonly kind: 'updated'; readonly pending: PendingUpdate }
  | { readonly kind: 'rollback-now'; readonly pending: PendingUpdate };

export interface LaunchCheckDeps {
  readonly paths: UpdatePaths;
  readonly version: string;
  /** A timer wake cannot prove renderer health and must not count as a failed interactive launch. */
  readonly background?: boolean;
  /** When a file was last written (epoch ms), undefined when it doesn't exist. */
  readonly modifiedAt?: (path: string) => number | undefined;
}

function fileModifiedAt(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * The guard's rule too (native/taalcut-cli SPEC): a marker counts only when written after this update was
 * prepared (a second of slack for the file system), so one from an earlier try of the version doesn't.
 */
function healthySince(modifiedAt: (path: string) => number | undefined, marker: string, at: number): boolean {
  const written = modifiedAt(marker);
  return written !== undefined && written >= at - 1000;
}

export function checkLaunch(deps: LaunchCheckDeps): LaunchVerdict {
  if (deps.background) return { kind: 'normal', cleanup: [] };
  const { paths, version } = deps;
  const modifiedAt = deps.modifiedAt ?? fileModifiedAt;
  const read = readUpdateFile(paths.pending, pendingUpdateSchema);
  if (!read.ok) {
    // A damaged pending file can't be trusted for a rollback; drop it rather than act on it.
    removeUpdateFile(paths.pending);
    return { kind: 'normal', cleanup: [paths.rollbackDir, paths.guardDir], problem: read.error };
  }
  const pending = read.value;
  if (!pending) return { kind: 'normal', cleanup: [] };
  if (version === pending.from) return { kind: 'normal', cleanup: [] };
  if (version !== pending.to || healthySince(modifiedAt, paths.healthy(pending.to), pending.at)) {
    removeUpdateFile(paths.pending);
    return { kind: 'normal', cleanup: [paths.rollbackDir, paths.guardDir, paths.failedDir] };
  }
  const counted: PendingUpdate = { ...pending, launchAttempts: pending.launchAttempts + 1 };
  const written = writeUpdateFile(paths.pending, counted);
  if (!written.ok) return { kind: 'normal', cleanup: [], problem: written.error };
  if (counted.launchAttempts >= ROLLBACK_AFTER_ATTEMPTS) return { kind: 'rollback-now', pending: counted };
  return { kind: 'updated', pending: counted };
}

/** The guard's arguments for each way it is started (the guard contract in native/taalcut-cli/SPEC.md). */
export function guardArguments(pendingFile: string, mode: 'watch' | 'rollback-now'): string[] {
  return ['update-guard', '--pending', pendingFile, ...(mode === 'rollback-now' ? ['--rollback-now'] : [])];
}
