// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  err,
  ok,
  upgradeTimeline,
  type AsyncResult,
  type TimelineId,
  type TimelineStore,
} from '@taalcut/core';

/** Verify durable timeline receipts before any AI tool may describe a mutation as committed. */
export function editorReceiptVerifier(store: Pick<TimelineStore, 'get'>) {
  return async (_command: string, result: unknown): AsyncResult<void> => {
    if (!result || typeof result !== 'object') return ok(undefined);
    const value = result as {
      timelineId?: TimelineId;
      revision?: number;
      timelineIds?: TimelineId[];
      receipts?: { timelineId: TimelineId; revision: number }[];
    };
    const receipts =
      value.receipts ??
      (value.timelineId && typeof value.revision === 'number'
        ? [{ timelineId: value.timelineId, revision: value.revision }]
        : (value.timelineIds ?? []).map((timelineId) => ({ timelineId, revision: undefined })));
    for (const receipt of receipts) {
      const stored = await store.get(receipt.timelineId);
      if (!stored.ok) return stored;
      const current = upgradeTimeline(stored.value.json, stored.value.schemaVersion);
      if (!current.ok) return current;
      if (receipt.revision !== undefined && current.value.revision !== receipt.revision)
        return err(
          ConflictError(
            { entity: 'timeline', id: receipt.timelineId },
            { detail: 'The committed document has changed; read it again before reporting the result.' },
          ),
        );
    }
    return ok(undefined);
  };
}
