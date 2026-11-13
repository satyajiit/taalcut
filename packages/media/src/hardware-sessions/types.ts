// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The hardware session gate's shape (gate.ts implements it across processes, local.ts in memory). */
import type { AsyncResult } from '@taalcut/core';

export interface HardwareSessionLease {
  /** Sessions held (the request, capped at the limit). */
  readonly weight: number;
  /** Gives the sessions back. Safe to call twice. */
  release(): Promise<void>;
  /**
   * Names a process that holds these sessions itself (a detached FFmpeg, the mac helper during a request): the
   * sessions stay held while that same process runs, even after this process is gone (a quit or a crash), with no
   * time cap (IX3-F5 H4, IX3-F7). The pid is on disk before this returns; its start time (pid reuse) follows when
   * `ps` answers. Never throws (a failure is logged); nothing after `release`. Absent where the lease lives only in
   * this process.
   */
  adopt?(pid: number): void;
  /** Takes a process off the record again (it let go of the sessions), synchronously like `adopt`. */
  forget?(pid: number): void;
}

export interface HardwareSessionGate {
  /**
   * Waits until `weight` sessions are free in every process sharing the
   * folder, then holds them. A weight above the limit waits for all of them.
   * Aborting the signal while waiting returns `media.cancelled`.
   */
  acquire(weight: number, signal?: AbortSignal): AsyncResult<HardwareSessionLease>;
  /** The limit in force (resolved once). */
  limit(): Promise<number>;
  /** Sessions held now by every process, for diagnostics and tests. */
  inUse(): Promise<number>;
}
