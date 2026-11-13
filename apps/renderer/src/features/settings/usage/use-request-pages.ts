// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings › Usage's request log, a page at a time (G8): the newest page for the view (its period, job, provider
 * and project, which `usage.list` applies), then older pages on request until there are none. A new first page
 * drops the older ones read for the last view.
 */
import { callRpc, type CloudCallRecord, type TaalcutError, type UsageListInput } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { periodRange, type UsageView } from './usage-search';

const PAGE = 50;

/** The view's filters as `usage.list` takes them: the period's start (none for all time), job, provider, project. */
function filters(view: UsageView, from: number): Omit<UsageListInput, 'limit' | 'before'> {
  return {
    ...(from > 0 ? { from } : {}),
    ...(view.module ? { module: view.module } : {}),
    ...(view.provider ? { provider: view.provider } : {}),
    ...(view.project ? { projectId: view.project } : {}),
  };
}

export function useRequestPages(view: UsageView) {
  const backend = useBackend();
  const { period, module, provider, project } = view;
  // The period ends when the page is read: its end is the first page's `before`, its start each page's `from`.
  const first = useRpcQuery(
    async (signal) => {
      const { from, to } = periodRange(period, Date.now());
      const where = filters({ period, module, provider, project }, from);
      const page = await backend.usage.list({ limit: PAGE, before: to, ...where }, { signal });
      return { page, where };
    },
    [backend, period, module, provider, project],
  );
  const [more, setMore] = useState<CloudCallRecord[]>([]);
  const [cursor, setCursor] = useState<number | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState<TaalcutError | null>(null);
  useEffect(() => {
    setMore([]);
    setFailed(null);
    setCursor(first.data?.page.nextBefore);
  }, [first.data]);

  async function loadMore() {
    if (cursor === undefined || !first.data) return;
    setLoadingMore(true);
    setFailed(null);
    const next = await callRpc(backend.usage.list({ limit: PAGE, before: cursor, ...first.data.where }));
    setLoadingMore(false);
    if (!next.ok) return setFailed(next.error);
    setMore((rows) => [...rows, ...next.value.records]);
    setCursor(next.value.nextBefore);
  }

  const from = first.data?.where.from ?? 0;
  return {
    first,
    records: [...(first.data?.page.records ?? []), ...more],
    // A cursor at the period's start has nothing older inside it (`from` must come before `before`).
    older: cursor !== undefined && cursor > from,
    loadingMore,
    failed,
    loadMore,
  };
}
