// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * After the guard put the previous version back (P3-B9), that version's main reads updates/rolled-back.json at
 * start. A fresh one is handled once: the failed version is blocked (blocked.ts), update.rolledBack is recorded
 * when telemetry is on, and the file becomes last-rollback.json, which About keeps showing
 * (UpdateState.lastRollback: "The update to {to} didn't start, so Taalcut went back to {from}. Nothing was
 * lost."). An install-failed.json (the update never replaced the app) is only logged and removed.
 */
import type { TaalcutError, UPDATE_ROLLBACK_REASONS } from '@taalcut/core';
import {
  installFailedSchema,
  readUpdateFile,
  removeUpdateFile,
  rolledBackSchema,
  writeUpdateFile,
  type RollbackReason,
  type RolledBack,
  type UpdatePaths,
} from './update-files';

export interface LastRollback {
  readonly from: string;
  readonly to: string;
  readonly at: number;
}

export interface RollbackNotice {
  /** What About shows; null when this Mac never rolled back. */
  readonly last: LastRollback | null;
  /** A rollback this launch is the first to see: block its version and record it. */
  readonly fresh: RolledBack | null;
  /** An update that never installed, for the log. */
  readonly installFailed: { readonly from: string; readonly to: string } | null;
  readonly problems: readonly TaalcutError[];
}

export function takeRollbackNotice(paths: UpdatePaths): RollbackNotice {
  const problems: TaalcutError[] = [];
  const fresh = readUpdateFile(paths.rolledBack, rolledBackSchema);
  if (!fresh.ok) {
    problems.push(fresh.error);
    removeUpdateFile(paths.rolledBack);
  } else if (fresh.value) {
    const moved = writeUpdateFile(paths.lastRollback, fresh.value);
    if (moved.ok) removeUpdateFile(paths.rolledBack);
    else problems.push(moved.error);
  }
  const last = readUpdateFile(paths.lastRollback, rolledBackSchema);
  if (!last.ok) problems.push(last.error);
  const failed = readUpdateFile(paths.installFailed, installFailedSchema);
  if (!failed.ok) problems.push(failed.error);
  if (!failed.ok || failed.value) removeUpdateFile(paths.installFailed);
  const lastValue = last.ok ? last.value : null;
  return {
    last: lastValue ? { from: lastValue.from, to: lastValue.to, at: lastValue.at } : null,
    fresh: fresh.ok ? fresh.value : null,
    installFailed: failed.ok && failed.value ? { from: failed.value.from, to: failed.value.to } : null,
    problems,
  };
}

/** The telemetry catalogue's reasons (core UPDATE_ROLLBACK_REASONS) for the guard's. */
export function rollbackTelemetryReason(reason: RollbackReason): (typeof UPDATE_ROLLBACK_REASONS)[number] {
  switch (reason) {
    case 'hung':
      return 'hung';
    case 'rollback-now':
      return 'attempts';
    case 'launch-failed':
    case 'install-timeout':
      return 'exited';
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}
