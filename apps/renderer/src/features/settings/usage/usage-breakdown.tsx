// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Settings › Usage › Breakdown (G8, UX4) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.6 + UX4
 * where the period's spend went, by job, by provider and by project (breakdowns.tsx), under the same period and
 *   filters as the other views; choosing a name filters all of Usage to it. A new filter keeps the last tables on
 *   screen, dimmed, until the new ones land; a first load shows bones only after 300 ms.
 * states: default · hover/focus/active (the tables' names and headers, the filter bar) · disabled (n/a) · loading
 *   (bones after 300 ms; stale dim) · error (LoadError with Try again) · success (the tables) · empty (nothing ever
 *   used a model: the kit's EmptyState, as on the overview)
 */
import { Trans } from '@lingui/react/macro';
import { Skeleton } from '@taalcut/ui';
import { BoneRows, type BoneRowShape } from '../bones';
import { LoadError } from '../fields';
import { Breakdowns } from './breakdowns';
import { useEverUsed, useProjectNames, useUsageSummary } from './use-usage-data';
import { UsageFilters } from './usage-filters';
import { NothingYet, UsageFrame } from './usage-frame';
import { hasFilters, type UsageView } from './usage-search';

const TABLE_BONES: readonly BoneRowShape[] = ['22%', '18%', '26%', '20%'].map((title) => ({
  title,
  control: 'none',
}));

export function UsageBreakdown({
  view,
  onViewChange,
}: {
  view: UsageView;
  onViewChange: (next: UsageView) => void;
}) {
  const summary = useUsageSummary(view);
  const projectNames = useProjectNames();
  const everUsed = useEverUsed();
  const data = summary.summary;
  const empty = everUsed === false && !hasFilters(view);
  const filter = (change: Partial<Pick<UsageView, 'module' | 'provider' | 'project'>>) =>
    onViewChange({ ...view, ...change });

  return (
    <UsageFrame
      current="breakdown"
      description={
        empty ? undefined : (
          <Trans>Where the period’s spend went. Choose a name to see only its numbers.</Trans>
        )
      }
      filters={
        empty ? null : (
          <UsageFilters view={view} summary={data} projectNames={projectNames} onChange={onViewChange} />
        )
      }
    >
      {empty ? (
        <NothingYet />
      ) : (
        <>
          {summary.error && !data ? (
            <LoadError
              error={summary.error}
              onRetry={summary.reload}
              what={<Trans>Your usage didn’t load.</Trans>}
            />
          ) : null}
          <Skeleton
            name="settings-usage-breakdown"
            loading={!data && summary.slow}
            fixture={<BoneRows rows={TABLE_BONES} />}
          >
            {data ? (
              <div className="flex flex-col">
                <Breakdowns
                  summary={data}
                  view={view}
                  projectNames={projectNames}
                  stale={summary.stale}
                  onFilter={filter}
                />
              </div>
            ) : null}
          </Skeleton>
        </>
      )}
    </UsageFrame>
  );
}
