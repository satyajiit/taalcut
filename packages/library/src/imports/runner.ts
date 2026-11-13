// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ok,
  publicErrorSchema,
  toTaalcutError,
  type ImportDraft,
  type ImportSession,
  type ImportSessionId,
} from '@taalcut/core';
import type { ImportAdapter, PreparedImportItem } from './adapter';
import { finishedImportItem } from './selection';
import type { ImportStore } from './store';
import { createAttemptProgress } from './attempt-progress';

export function createImportRunner(
  store: ImportStore,
  changed: (immediate?: boolean) => void,
  now: () => number,
) {
  const attempts = new Map<ImportSessionId, { controller: AbortController; done: Promise<void> }>();
  function launch(
    session: ImportSession,
    draft: ImportDraft,
    items: readonly PreparedImportItem[],
    privateData: unknown,
    adapter: ImportAdapter,
  ) {
    if (attempts.has(session.id)) return;
    const controller = new AbortController();
    const progress = createAttemptProgress(store, session, items, changed, now, controller.signal);
    const done = Promise.resolve()
      .then(async () => {
        let result;
        try {
          result = await adapter.run({
            session,
            draft,
            items,
            privateData,
            signal: controller.signal,
            report: progress.report,
            source: progress.source,
            checkpoint: (data) => store.checkpoint(draft.id, data),
            progress: progress.progress,
          });
        } catch (cause) {
          result = { ok: false as const, error: toTaalcutError(cause) };
        }
        if (!result.ok && !controller.signal.aborted)
          progress.failRemaining(publicErrorSchema.parse(result.error));
        progress.flush();
        const latest = store.session(session.id);
        if (!latest) return;
        const outcomes = [...progress.outcomes.values()];
        const remaining = outcomes.some((item) => !finishedImportItem(item));
        const complete = outcomes.every((item) => item.result?.kind !== 'archived' || item.result.complete);
        const status =
          latest.status === 'running'
            ? remaining
              ? outcomes.some(finishedImportItem)
                ? 'partial'
                : 'failed'
              : 'completed'
            : latest.status;
        store.saveSession({
          ...latest,
          status,
          updatedAt: now(),
          finishedAt: status === 'paused' || status === 'interrupted' ? null : now(),
          stage: 'checking',
          safeToDisconnect: complete && !remaining,
          progress: {
            ...latest.progress,
            ...progress.counts,
            currentFile: null,
            bytesPerSecond: null,
            etaSeconds: null,
          },
        });
        changed(true);
      })
      .finally(() => {
        attempts.delete(session.id);
      });
    attempts.set(session.id, { controller, done });
  }
  return {
    launch,
    async stop(id: ImportSessionId, reason = 'pause') {
      const attempt = attempts.get(id);
      attempt?.controller.abort(reason);
      await attempt?.done;
      return ok(undefined);
    },
    async close() {
      for (const attempt of attempts.values()) attempt.controller.abort('shutdown');
      await Promise.all([...attempts.values()].map((attempt) => attempt.done));
    },
  };
}
