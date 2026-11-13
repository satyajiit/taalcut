// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A lease on slots in the session folder (gate.ts takes them): a heartbeat on its files while held, `adopt` and
 * `forget` for the processes that hold its sessions themselves, and `release` to remove its files.
 *
 * `adopt` writes the pid into the slot files synchronously, before it returns (IX3-F7): a quit (`process.exit`) or a
 * crash right after a spawn or a send still leaves the pid on disk, and the slot stays held while that pid lives. The
 * start time (pid reuse) is added when `ps` answers; a `ps` that fails, times out or doesn't exist (Windows) leaves
 * the pid with no start, which the sweeper keeps while the pid lives. No time cap.
 */
import { removeOwned, rewriteOwnedSync, heartbeat, type Holder, type SessionChild } from './folder';
import type { ProcessStart } from './process-start';
import type { HardwareSessionLease } from './types';

export interface FolderLeaseOptions {
  readonly heartbeatMs: number;
  readonly startOf: (pid: number) => Promise<ProcessStart>;
  readonly isAlive: (pid: number) => boolean;
  readonly log: (line: string) => void;
  /** Logs a line once per gate (an unreadable start would otherwise be said at every spawn). */
  readonly logOnce: (key: string, line: string) => void;
}

export function folderLease(
  dir: string,
  names: readonly string[],
  holder: Holder,
  options: FolderLeaseOptions,
): HardwareSessionLease {
  const { heartbeatMs, log } = options;
  const beat = heartbeat(dir, names, heartbeatMs);
  /** pid → its start once `ps` gave it. */
  const children = new Map<number, string | undefined>();
  let released = false;

  /** Every write is synchronous and writes the whole record, so writes can't overtake one another. */
  function write(what: string): void {
    if (released) return;
    const record: SessionChild[] = [...children].map(([pid, started]) =>
      started === undefined ? { pid } : { pid, started },
    );
    try {
      rewriteOwnedSync(dir, names, { ...holder, ...(record.length > 0 ? { children: record } : {}) });
    } catch (cause) {
      log(`could not ${what} in hardware session ${names.join(', ')}: ${String(cause)}`);
    }
  }

  function started(pid: number, start: ProcessStart): void {
    if (!children.has(pid)) return;
    if (start.kind === 'started') {
      children.set(pid, start.at);
      write(`add the start of pid ${pid}`);
    } else if (start.kind === 'gone' && !options.isAlive(pid)) {
      // It already exited: nothing to keep the slot for.
      children.delete(pid);
      write(`take pid ${pid} off`);
    } else if (start.kind === 'unknown') {
      options.logOnce(
        'unknown-start',
        `could not read when pid ${pid} started (${start.detail}); a slot keeps such a pid while it lives`,
      );
    }
  }

  return {
    weight: names.length,
    adopt(pid) {
      if (released || children.has(pid)) return;
      children.set(pid, undefined);
      write(`record pid ${pid}`);
      void options.startOf(pid).then(
        (start) => started(pid, start),
        (cause: unknown) => started(pid, { kind: 'unknown', detail: String(cause) }),
      );
    },
    forget(pid) {
      if (!children.delete(pid)) return;
      write(`take pid ${pid} off`);
    },
    async release() {
      if (released) return;
      released = true;
      beat.stop();
      await removeOwned(dir, names, holder.token);
    },
  };
}
