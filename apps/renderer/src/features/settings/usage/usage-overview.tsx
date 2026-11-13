// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Settings › Usage › Overview (G8, UX4) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.6 + UX4
 * what it cost and what is limited now, for the period and filters (on the views' row, in the URL): Now (only
 *   while something is limited), the totals strip (its numbers tick to the new view's), spend by day, then the
 *   plans you signed in with. Where it went, the budgets and every request are their own views. A new period or
 *   filter keeps the last numbers on screen, dimmed (StaleContent), until the new ones land; a first load shows
 *   bones only after 300 ms.
 * states: default · hover/focus/active (each part's controls) · disabled (n/a) · loading (bones after 300 ms;
 *   stale dim) · error (LoadError with Try again) · success (the numbers) · empty (nothing ever used a model: the
 *   kit's EmptyState, Kaatu and Start a chat)
 */
import { Trans } from '@lingui/react/macro';
import { CONCEPT_ICONS, PageSection, Skeleton, SkeletonLines } from '@taalcut/ui';
import { LoadError } from '../fields';
import { SpendByDay } from './spend-by-day';
import { SubscriptionsLine } from './subscriptions-line';
import { useEverUsed, useProjectNames, useUsageLimits, useUsageSummary } from './use-usage-data';
import { UsageFilters } from './usage-filters';
import { NothingYet, UsageFrame } from './usage-frame';
import { UsageNow } from './usage-now';
import { hasFilters, type UsageView } from './usage-search';
import { UsageTiles } from './usage-tiles';

/** Bones in the shape of the totals strip and the chart, while the first numbers are slow to come. */
function UsageBones() {
  return (
    <div data-slot="usage-bones" className="flex flex-col gap-6">
      <div
        aria-hidden
        className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule-subtle bg-rule-subtle sm:grid-cols-2 xl:grid-cols-4"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 bg-raised px-4 py-3.5">
            <span className="tc-bone block h-3 w-16 rounded-sm bg-hover" />
            <span className="tc-bone block h-6 w-24 rounded-sm bg-hover" />
          </div>
        ))}
      </div>
      <SkeletonLines lines={4} />
    </div>
  );
}

/**
 * Settings › Usage (PRD 9.3, G8): for any of the last 30 days and beyond, what Taalcut spent, which limits are in
 * force and when they reset, and the plans it uses. Sizes and counts only, never prompts or keys.
 */
export function UsageOverview({
  view,
  onViewChange,
}: {
  view: UsageView;
  onViewChange: (next: UsageView) => void;
}) {
  const summary = useUsageSummary(view);
  const limits = useUsageLimits();
  const projectNames = useProjectNames();
  const everUsed = useEverUsed();
  const data = summary.summary;
  const empty = everUsed === false && !hasFilters(view);

  return (
    <UsageFrame
      current="overview"
      description={<Trans>What Taalcut spent on models, and any limit a provider has set right now.</Trans>}
      filters={
        empty ? null : (
          <UsageFilters view={view} summary={data} projectNames={projectNames} onChange={onViewChange} />
        )
      }
    >
      <UsageNow limits={limits} />
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
          {/* Bones only once the answer is slow (300 ms): a quick answer doesn't flash them. */}
          <Skeleton name="settings-usage" loading={!data && summary.slow} fixture={<UsageBones />}>
            {data ? (
              <div className="flex flex-col">
                <PageSection title={<Trans>Totals</Trans>} icon={CONCEPT_ICONS.usage}>
                  <UsageTiles totals={data.totals} stale={summary.stale} />
                </PageSection>
                <SpendByDay
                  summary={data}
                  allTime={view.period === 'all'}
                  project={view.project}
                  stale={summary.stale}
                />
              </div>
            ) : null}
          </Skeleton>
        </>
      )}
      <SubscriptionsLine />
    </UsageFrame>
  );
}
