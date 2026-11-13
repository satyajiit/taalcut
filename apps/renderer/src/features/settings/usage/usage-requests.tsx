// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Settings › Usage › Requests (G8, UX4) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.6 + UX4
 * every request to a model for the period and filters, newest first (request-log.tsx); the filter bar on the views'
 *   row narrows it, and the backend does the narrowing (usage.list). The summary is read only for the filter bar's
 *   list of providers.
 * states: as RequestLog (loading bones · error with Try again · rows · empty line for the filter) · empty (nothing
 *   ever used a model: the kit's EmptyState, as on the overview)
 */
import { useEverUsed, useProjectNames, useUsageSummary } from './use-usage-data';
import { RequestLog } from './request-log';
import { UsageFilters } from './usage-filters';
import { NothingYet, UsageFrame } from './usage-frame';
import { hasFilters, type UsageView } from './usage-search';

export function UsageRequests({
  view,
  onViewChange,
}: {
  view: UsageView;
  onViewChange: (next: UsageView) => void;
}) {
  const summary = useUsageSummary(view);
  const projectNames = useProjectNames();
  const everUsed = useEverUsed();
  const empty = everUsed === false && !hasFilters(view);
  return (
    <UsageFrame
      current="requests"
      filters={
        empty ? null : (
          <UsageFilters
            view={view}
            summary={summary.summary}
            projectNames={projectNames}
            onChange={onViewChange}
          />
        )
      }
    >
      {empty ? <NothingYet /> : <RequestLog view={view} />}
    </UsageFrame>
  );
}
