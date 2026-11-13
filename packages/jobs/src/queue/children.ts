// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Jobs started for a running job (core's `JobRunOptions.parentJobId`, round P3-3): an export that bakes a grade
 * LUT or tracks a subject while it holds its 'gpu' slot. The parent waits for its child, so the child can't wait
 * for a free slot of its class behind its own parent: the engine claims it by id, outside the limit, while the
 * parent runs in this engine. The link is kept in memory only. After a restart the parent runs again and asks
 * for the same child (its idempotency key finds the queued job), and a child whose parent isn't running here is
 * an ordinary job that waits for the pool.
 */
import type { JobId, Result, TaalcutError } from '@taalcut/core';
import type { JobRecord } from './types';

/** What the engine lends: its runs, its claim pass and the store, all read when used. */
export interface ChildJobsHost {
  /** Whether a job runs in this engine now. */
  running(id: JobId): boolean;
  /** Whether the engine claims at all (started, not paused). */
  active(): boolean;
  /** The store's claim of exactly this job, if it is due. */
  claim(id: JobId): Promise<Result<JobRecord | null>>;
  launch(record: JobRecord): void;
  storeError(error: TaalcutError): void;
  /** A claim pass soon. */
  wake(): void;
}

export class ChildJobs {
  /** child → parent */
  private readonly parents = new Map<JobId, JobId>();

  constructor(private readonly host: ChildJobsHost) {}

  /** After an enqueue: a queued job whose parent runs here becomes its child, and a job its key matched is woken. */
  adopt(stored: Result<{ job: JobRecord; created: boolean }>, parent: JobId | undefined): void {
    if (!stored.ok || parent === undefined || !this.host.running(parent)) return;
    if (stored.value.job.state === 'queued') this.parents.set(stored.value.job.id, parent);
    // A created job wakes the claim pass already.
    if (!stored.value.created) this.host.wake();
  }

  /** Claims the children of running parents, each by id; forgets the children of parents that stopped. */
  async claim(): Promise<void> {
    if (!this.host.active()) return;
    for (const id of this.claimable()) {
      const claimed = await this.host.claim(id);
      if (!claimed.ok) return this.host.storeError(claimed.error);
      if (claimed.value) this.host.launch(claimed.value);
    }
  }

  private claimable(): JobId[] {
    const ids: JobId[] = [];
    for (const [child, parent] of this.parents) {
      if (!this.host.running(parent)) this.parents.delete(child);
      else if (!this.host.running(child)) ids.push(child);
    }
    return ids;
  }
}
