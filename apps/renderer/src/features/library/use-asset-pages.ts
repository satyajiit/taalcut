// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { fromRpcError, type AssetSummary, type LibraryFilters, type TaalcutError } from '@taalcut/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';

/** Clips per request: the contract's largest page, so 5,000 clips are 25 requests. */
const PAGE = 200;

interface Run {
  cursor?: string | undefined;
  done: boolean;
  busy: boolean;
  loaded: number;
  /** How many clips the grid wants in. */
  want: number;
  abort: AbortController;
  /**
   * A refresh in place: pages collect here and replace the grid's clips at once when the
   * clips already on screen are in again, so the grid never blanks while indexing updates it.
   */
  buffer?: AssetSummary[];
}

const fresh = (abort: AbortController, want = PAGE, soft = false): Run => ({
  done: false,
  busy: false,
  loaded: 0,
  want,
  abort,
  ...(soft ? { buffer: [] } : {}),
});

/** Inert until the page effect starts its own run, so a child's mount `ensure` only records `want`. */
const idle = (): Run => ({ ...fresh(new AbortController(), 0), done: true });

function dedupeAssets(items: readonly AssetSummary[]): AssetSummary[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export interface AssetPages {
  /** Clips loaded so far, in order. */
  readonly items: readonly AssetSummary[];
  /** How many match; null before the first page. */
  readonly total: number | null;
  readonly error: TaalcutError | null;
  /** Load until at least `count` clips are in (as the grid scrolls towards them). */
  ensure(count: number): void;
  reload(): void;
}

/**
 * The grid's clips, a page at a time. The library's cursor is opaque, so
 * pages load in order; scrolling far ahead chains requests until the rows on
 * screen are in, and the grid draws still bones for the rest meanwhile.
 * Changing the filters or sort starts again; so does a change to the library
 * (library.changed for clips or sources).
 */
export function useAssetPages(filters: LibraryFilters, sort: string, direction: 'asc' | 'desc'): AssetPages {
  const backend = useBackend();
  const key = JSON.stringify([filters, sort, direction]);
  const [state, setState] = useState<{
    items: AssetSummary[];
    total: number | null;
    error: TaalcutError | null;
  }>({
    items: [],
    total: null,
    error: null,
  });
  const [round, setRound] = useState(0);
  const run = useRef<Run>(idle());

  const pump = useCallback(() => {
    const current = run.current;
    if (current.busy || current.done) return;
    current.busy = true;
    const { signal } = current.abort;
    const [parsedFilters, parsedSort, parsedDirection] = JSON.parse(key) as [
      LibraryFilters,
      typeof sort,
      typeof direction,
    ];
    backend.library
      .browse(
        {
          filters: parsedFilters,
          sort: parsedSort as 'captured',
          direction: parsedDirection,
          limit: PAGE,
          ...(current.cursor ? { cursor: current.cursor } : {}),
        },
        { signal },
      )
      .then(
        (page) => {
          if (signal.aborted || run.current !== current) return;
          current.cursor = page.nextCursor;
          current.done = !page.nextCursor;
          current.busy = false;
          current.loaded += page.items.length;
          if (current.buffer) {
            current.buffer.push(...page.items);
            if (current.done || current.loaded >= current.want) {
              const items = dedupeAssets(current.buffer);
              delete current.buffer;
              setState({ items, total: page.total, error: null });
            }
          } else {
            setState((prev) => ({
              items: dedupeAssets([...prev.items, ...page.items]),
              total: page.total,
              error: null,
            }));
          }
          if (!current.done && current.loaded < current.want) pump();
        },
        (cause: unknown) => {
          if (signal.aborted || run.current !== current) return;
          current.busy = false;
          setState((prev) => ({ ...prev, error: fromRpcError(cause) }));
        },
      );
  }, [backend, key]);

  useEffect(() => {
    const previous = run.current;
    previous.abort.abort();
    const abort = new AbortController();
    run.current = fresh(abort, Math.max(PAGE, previous.done ? previous.want : 0));
    setState({ items: [], total: null, error: null });
    pump();
    return () => {
      abort.abort();
      if (run.current.abort !== abort) run.current.abort.abort();
      run.current = idle();
    };
  }, [pump, round]);

  // Clips that changed in place (indexing filled in facts, pictures, analysis): the same clips
  // again, swapped in when loaded. New, removed or moved clips start the list again.
  const [updates, setUpdates] = useState(0);
  const handled = useRef(0);
  useEffect(() => {
    // Only for a new update; a filter change (a new pump) has already started the list again.
    if (updates === handled.current) return;
    handled.current = updates;
    const previous = run.current;
    previous.abort.abort();
    const abort = new AbortController();
    run.current = fresh(abort, Math.max(PAGE, previous.loaded, previous.want), true);
    pump();
    return () => abort.abort();
  }, [pump, updates]);

  useBackendEvents(['library.changed'], ({ payload }) => {
    if (payload.entity === 'asset' && payload.change === 'deleted') {
      const gone = new Set<string>(payload.ids);
      setState((prev) => {
        const items = prev.items.filter((item) => !gone.has(item.id));
        const removed = prev.items.length - items.length;
        return removed === 0
          ? prev
          : { ...prev, items, total: prev.total === null ? null : Math.max(0, prev.total - removed) };
      });
      setUpdates((n) => n + 1);
    } else if (payload.entity === 'asset') {
      setUpdates((n) => n + 1);
    } else if (payload.entity === 'source') {
      setRound((n) => n + 1);
    }
  });
  // Clips that just became searchable or complete (IX): their chips change in place, like any update.
  useBackendEvents(['library.indexMilestone'], () => setUpdates((n) => n + 1));

  const ensure = useCallback(
    (count: number) => {
      const current = run.current;
      current.want = Math.max(current.want, count);
      if (current.loaded < current.want) pump();
    },
    [pump],
  );
  const reload = useCallback(() => setRound((n) => n + 1), []);

  return { items: state.items, total: state.total, error: state.error, ensure, reload };
}
