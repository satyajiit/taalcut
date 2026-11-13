// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the component manager's close() waits for (UX2-DOWNLOADER round 2): every install, update, remove, cleanup
 * and discard under way. Once closed, new work doesn't start (one that returns a Result says core.cancelled), so
 * once close() resolves nothing of it writes under the components folder any more.
 */
import { CancelledError, err, type AsyncResult } from '@taalcut/core';

export class WorkGate {
  private isClosed = false;
  private readonly busy = new Set<Promise<unknown>>();

  get closed(): boolean {
    return this.isClosed;
  }

  /** Runs `work` where close() waits for it; once closed, says core.cancelled instead. */
  run<T>(work: () => AsyncResult<T>): AsyncResult<T> {
    return this.isClosed ? Promise.resolve(err(CancelledError())) : this.track(work);
  }

  /** Runs `work` where close() waits for it; once closed, does nothing. */
  async runQuietly(work: () => Promise<void>): Promise<void> {
    if (!this.isClosed) await this.track(work);
  }

  /** No new work from the call on; resolves once the work under way has finished (nothing can join it). */
  async close(): Promise<void> {
    this.isClosed = true;
    await Promise.allSettled([...this.busy]);
  }

  private track<T>(work: () => Promise<T>): Promise<T> {
    const running = work();
    this.busy.add(running);
    const done = () => this.busy.delete(running);
    void running.then(done, done);
    return running;
  }
}
