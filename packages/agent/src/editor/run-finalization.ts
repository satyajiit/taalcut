// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ok, type AsyncResult, type EditingOwnership, type RunId } from '@taalcut/core';

/** Lifecycle writes finish before ownership is released; tool dispatch remains revoked throughout cleanup. */
export function createRunFinalization(editing: EditingOwnership | undefined) {
  const listeners = new Set<(runId: RunId) => AsyncResult<void>>();
  const completed = new Set<RunId>();
  const running = new Map<RunId, AsyncResult<void>>();
  async function finish(runId: RunId): AsyncResult<void> {
    editing?.stop(runId);
    await editing?.drain();
    for (const listener of listeners) {
      const result = await listener(runId);
      if (!result.ok) return result;
    }
    await editing?.release(runId);
    completed.add(runId);
    return ok(undefined);
  }
  return {
    subscribe(listener: (runId: RunId) => AsyncResult<void>) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    finish(runId: RunId): AsyncResult<void> {
      if (completed.has(runId)) return Promise.resolve(ok(undefined));
      const pending = running.get(runId);
      if (pending) return pending;
      const task = finish(runId).finally(() => running.delete(runId));
      running.set(runId, task);
      return task;
    },
  };
}
