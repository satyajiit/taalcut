// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What Settings › Usage reads (G8): the period's summary (aggregated in the agent process, asked once per
 * period and filter), the limits in force (live), the project names, and whether anything ever called a model.
 * A new view keeps the last one on screen, marked stale, until its numbers arrive (no skeleton flash); a
 * skeleton shows only when the first answer takes longer than 300 ms.
 */
import type { ProjectId, TaalcutError, UsageLimit, UsageSummary } from '@taalcut/core';
import { useEffect, useMemo, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery, useRpcStream } from '../../../backend/use-rpc';
import { localTimeZone, periodRange, type UsageView } from './usage-search';

/** True once `on` has stayed true for `ms` (a loader that doesn't flash for a quick answer). */
export function useAfter(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && late;
}

const keyOf = (view: UsageView) => [view.period, view.module, view.provider, view.project].join('|');

export interface SummaryState {
  /** The latest summary, possibly for the previous view (see `stale`). */
  readonly summary: UsageSummary | undefined;
  /** The numbers on screen belong to the view before this one; the new ones are on their way. */
  readonly stale: boolean;
  /** Nothing to show yet and the answer is taking a while: show the skeleton. */
  readonly slow: boolean;
  readonly error: TaalcutError | undefined;
  reload(): void;
}

export function useUsageSummary(view: UsageView): SummaryState {
  const backend = useBackend();
  const key = keyOf(view);
  const query = useRpcQuery(
    async (signal) => {
      const { from, to } = periodRange(view.period, Date.now());
      const summary = await backend.usage.summary(
        {
          from,
          to,
          timeZone: localTimeZone(),
          ...(view.module ? { module: view.module } : {}),
          ...(view.provider ? { provider: view.provider } : {}),
          ...(view.project ? { projectId: view.project } : {}),
        },
        { signal },
      );
      return { key, summary };
    },
    [backend, key],
  );
  const current = query.data?.key === key;
  const waiting = query.status === 'loading' || (query.status === 'ready' && !current);
  const slow = useAfter(waiting && !query.data, 300);
  return {
    summary: query.data?.summary,
    stale: query.data !== undefined && !current,
    slow,
    error: query.status === 'error' ? query.error : undefined,
    reload: query.reload,
  };
}

/** The limits the models client is waiting on: the current list, then every change. */
export function useUsageLimits(): readonly UsageLimit[] {
  const backend = useBackend();
  const limits = useRpcStream((signal) => backend.usage.limitsChanged(undefined, { signal }), [backend]);
  return limits.data ?? [];
}

/** Project ids to names, for the project table and the filter (names are the person's: shown as written). */
export function useProjectNames(): ReadonlyMap<ProjectId, string> {
  const backend = useBackend();
  const projects = useRpcQuery((signal) => backend.projects.list({}, { signal }), [backend]);
  return useMemo(
    () => new Map((projects.data?.items ?? []).map((project) => [project.id, project.name] as const)),
    [projects.data],
  );
}

/** Whether any request to a model was ever made (null while unknown): the page's empty state. */
export function useEverUsed(): boolean | null {
  const backend = useBackend();
  const first = useRpcQuery((signal) => backend.usage.list({ limit: 1 }, { signal }), [backend]);
  return first.data ? first.data.totals.calls > 0 : null;
}
