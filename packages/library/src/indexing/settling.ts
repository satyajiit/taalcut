// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Finished jobs whose outcome and feed are still on the way (round IX, IX-S4): `IndexingPipeline.settled`
 * answers from here, and the job engine waits for it before it offers the job's slot again.
 */
import type { JobId, JobState } from '@taalcut/core';

/** A state after which the job never runs again. */
export const isFinal = (state: JobState): boolean =>
  state === 'succeeded' || state === 'failed' || state === 'cancelled';

export class Settling {
  private readonly pending = new Map<JobId, Promise<void>>();

  /** Follows `step` for `jobId` until it settles. */
  track(jobId: JobId, step: Promise<unknown>): void {
    const done = step.then(() => undefined);
    this.pending.set(jobId, done);
    // A failed step is already logged by the pipeline's chain (serial); this only forgets the entry.
    void done
      .catch(() => undefined)
      .finally(() => {
        if (this.pending.get(jobId) === done) this.pending.delete(jobId);
      });
  }

  /** Resolves once `jobId`'s tracked step settled; at once for a job not tracked. */
  settled(jobId: JobId): Promise<void> {
    return this.pending.get(jobId) ?? Promise.resolve();
  }
}
