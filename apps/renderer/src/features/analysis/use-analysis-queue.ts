// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The clips the window bar's analysis popover lists (LIB1-PROG): those being analysed now, newest first, read only
 * while the popover is open, and again whenever the indexing status moves on under it. Not the ones held for a
 * model: the popover says how many of those there are, and where to get the model.
 */
import { callRpc, type AssetSummary, type TaalcutError } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { useBackend } from '../../backend/backend';

/** How many clips the popover names; the rest are counted. */
export const QUEUE_SHOWN = 6;

export interface AnalysisQueue {
  readonly items: readonly AssetSummary[];
  readonly total: number;
  readonly error: TaalcutError | null;
  readonly loaded: boolean;
}

const EMPTY: AnalysisQueue = { items: [], total: 0, error: null, loaded: false };

export function useAnalysisQueue(open: boolean, moved: number): AnalysisQueue {
  const backend = useBackend();
  const [queue, setQueue] = useState<AnalysisQueue>(EMPTY);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void callRpc(
      backend.library.browse(
        { filters: { indexStates: ['indexing'] }, sort: 'added', direction: 'desc', limit: QUEUE_SHOWN },
        { signal: controller.signal },
      ),
    ).then((result) => {
      if (controller.signal.aborted) return;
      setQueue(
        result.ok
          ? { items: result.value.items, total: result.value.total, error: null, loaded: true }
          : (last) => ({ ...last, error: result.error, loaded: true }),
      );
    });
    return () => controller.abort();
  }, [backend, open, moved]);
  return open ? queue : EMPTY;
}
