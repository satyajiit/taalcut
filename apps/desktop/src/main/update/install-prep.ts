// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Before Squirrel replaces the app (P3-B9): keep a way back. When an update is staged, `prepare` clones the
 * running bundle to updates/rollback/Taalcut-<from>.app and writes pending.json last, so pending.json always
 * means the clone is there. When the app quits (ShipIt installs on quit) or the person picks Restart now, `arm`
 * copies the guard (Resources/bin/taalcut) out of the running bundle to updates/guard/, so it outlives the bundle
 * swap, and starts it there, detached, logging to updates/guard.log. The copy is made at that moment, never at
 * staging (security review SB-40, guard-binary.ts). Without a guard binary (an unpackaged run) there is no
 * rollback: the caller logs desktop.update_guard_missing and the update goes ahead.
 */
import { existsSync } from 'node:fs';
import {
  defineError,
  err,
  ok,
  toTaalcutError,
  type AsyncResult,
  type Result,
  type UpdateChannel,
} from '@taalcut/core';
import type { BundleOps } from './bundle-ops';
import { installGuard } from './guard-binary';
import { guardArguments } from './launch-check';
import { writeUpdateFile, type PendingUpdate, type UpdatePaths } from './update-files';

/** This build has no update guard (Resources/bin/taalcut): an update can't be rolled back. */
export const UpdateGuardMissing = defineError('desktop.update_guard_missing');
/** The rollback copy or the guard couldn't be prepared; detail says which step. */
export const UpdatePrepFailed = defineError('desktop.update_prep_failed', { retryable: true });

export interface InstallPrepDeps {
  readonly paths: UpdatePaths;
  /** The running bundle, which Squirrel replaces. */
  readonly appPath: string;
  /** The running version: the one a rollback restores. */
  readonly version: string;
  readonly library: string;
  /** The guard inside the running bundle (Contents/Resources/bin/taalcut). */
  readonly guardSource: string;
  readonly bundles: BundleOps;
  /** Starts `binary` detached (its own session) with stdout and stderr appended to `logFile`. */
  readonly spawnDetached: (binary: string, args: readonly string[], logFile: string) => void;
  readonly now: () => number;
  readonly exists?: (path: string) => boolean;
  /** Puts a fresh copy of the guard at its place in updates/ (guard-binary.ts). */
  readonly copyExecutable?: (from: string, to: string) => void;
}

export interface StagedUpdate {
  readonly to: string;
  readonly channel?: UpdateChannel;
  readonly delta?: boolean;
}

export interface InstallPrep {
  prepare(update: StagedUpdate): AsyncResult<PendingUpdate>;
  /** Starts the guard for the prepared update; a second call does nothing. */
  arm(): Result<boolean>;
}

/** A thrown value's message, for the log (the detail never reaches a window). */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createInstallPrep(deps: InstallPrepDeps): InstallPrep {
  const exists = deps.exists ?? existsSync;
  const copy = deps.copyExecutable ?? installGuard;
  let prepared: PendingUpdate | undefined;
  let armed = false;
  return {
    async prepare(update) {
      if (!exists(deps.guardSource)) return err(UpdateGuardMissing(undefined, { detail: deps.guardSource }));
      const rollbackApp = deps.paths.rollbackApp(deps.version);
      try {
        await deps.bundles.clone(deps.appPath, rollbackApp);
      } catch (cause) {
        return err(UpdatePrepFailed(undefined, { detail: `clone: ${toTaalcutError(cause).detail ?? ''}` }));
      }
      const pending: PendingUpdate = {
        v: 1,
        from: deps.version,
        to: update.to,
        appPath: deps.appPath,
        rollbackApp,
        library: deps.library,
        at: deps.now(),
        launchAttempts: 0,
        ...(update.channel ? { channel: update.channel } : {}),
        ...(update.delta !== undefined ? { delta: update.delta } : {}),
      };
      const written = writeUpdateFile(deps.paths.pending, pending);
      if (!written.ok) return written;
      prepared = pending;
      armed = false;
      return ok(pending);
    },
    arm() {
      if (!prepared || armed) return ok(false);
      try {
        copy(deps.guardSource, deps.paths.guardBinary);
      } catch (cause) {
        return err(UpdatePrepFailed(undefined, { detail: `guard: ${messageOf(cause)}` }));
      }
      try {
        deps.spawnDetached(
          deps.paths.guardBinary,
          guardArguments(deps.paths.pending, 'watch'),
          deps.paths.guardLog,
        );
      } catch (cause) {
        return err(UpdatePrepFailed(undefined, { detail: `spawn: ${messageOf(cause)}` }));
      }
      armed = true;
      return ok(true);
    },
  };
}
