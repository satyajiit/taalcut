// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Usage › the period and filters · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.6 + UX4
 * one row above everything it scopes: the period first (the kit's Segmented: 7 days, 30 days, This month, All
 *   time), then Job, Provider and Project as the Library's filter pills (one filter idiom across the app, UX1
 *   M11), and Clear filters when one is set. A pill is as wide as its name until it is set, so the row keeps its
 *   layout before and after the numbers arrive (M8). Every change lands in the URL (search params), so the view
 *   can be linked and survives a reload.
 * states: default · hover/focus/active (Segmented, FilterPill, Button) · disabled (Project, with no projects) ·
 *   loading (the view below holds, stale) · error (n/a: choices are local) · success (the view below is the answer)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { MODEL_MODULE_IDS, type ModelModuleId, type ProjectId, type UsageSummary } from '@taalcut/core';
import { Button, Segmented, VERB_ICONS } from '@taalcut/ui';
import { FilterPill, type FilterOption } from '../../library/filter-pill';
import { hasFilters, type UsagePeriod, type UsageView } from './usage-search';
import { jobName, providerLabel } from './usage-words';

export function UsageFilters({
  view,
  summary,
  projectNames,
  onChange,
}: {
  view: UsageView;
  /** What the period has, for the provider list. */
  summary: UsageSummary | undefined;
  projectNames: ReadonlyMap<ProjectId, string>;
  onChange: (next: UsageView) => void;
}) {
  const { t, i18n } = useLingui();
  const providers = new Map<string, string>();
  for (const row of summary?.byProvider ?? [])
    providers.set(row.provider, providerLabel(i18n, row.provider, row.local) ?? row.provider);
  if (view.provider && !providers.has(view.provider))
    providers.set(view.provider, providerLabel(i18n, view.provider, false) ?? view.provider);
  const periods: { value: UsagePeriod; label: string }[] = [
    { value: '7d', label: t`7 days` },
    { value: '30d', label: t`30 days` },
    { value: 'month', label: t`This month` },
    { value: 'all', label: t`All time` },
  ];
  const jobs: FilterOption<ModelModuleId>[] = MODEL_MODULE_IDS.map((id) => ({
    value: id,
    label: jobName(i18n, id),
  }));
  const providerOptions: FilterOption<string>[] = [...providers].map(([value, label]) => ({ value, label }));
  const projects: FilterOption<ProjectId>[] = [...projectNames].map(([value, label]) => ({
    value,
    label,
    raw: true,
  }));
  return (
    <div data-slot="usage-filters" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Segmented
        label={t`Period`}
        value={view.period}
        options={periods}
        onChange={(period) => onChange({ ...view, period })}
      />
      <span aria-hidden className="mx-1 h-5 w-px bg-rule-subtle" />
      <FilterPill
        label={t`Job`}
        value={view.module ?? undefined}
        options={jobs}
        onChange={(module) => onChange({ ...view, module: module ?? null })}
      />
      <FilterPill
        label={t`Provider`}
        value={view.provider ?? undefined}
        options={providerOptions}
        onChange={(provider) => onChange({ ...view, provider: provider ?? null })}
      />
      <FilterPill
        label={t`Project`}
        value={view.project ?? undefined}
        options={projects}
        disabled={projects.length === 0 && !view.project}
        onChange={(project) => onChange({ ...view, project: project ?? null })}
      />
      {hasFilters(view) ? (
        <Button
          variant="ghost"
          size="sm"
          icon={VERB_ICONS.clearFilters}
          onClick={() => onChange({ ...view, module: null, provider: null, project: null })}
        >
          <Trans>Clear filters</Trans>
        </Button>
      ) : null}
    </div>
  );
}
