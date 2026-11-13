// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Usage › Breakdown: by job, by provider, by project · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.6 + UX4 (the kit's PageSection)
 * three compact hairline tables, each its own section with its glyph, each row a filter for the whole of Usage (the
 *   URL carries it to the other views); the project table carries each project's budget meter (its whole spend
 *   against its cap), and its section's action goes to Budgets.
 * states: as BreakdownTable (default · hover · focus · active filter · loading stale · empty), the link's
 *   hover/focus/active
 */
import type { I18n } from '@lingui/core';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ProjectId, UsageSummary } from '@taalcut/core';
import { Button, CONCEPT_ICONS, PageSection, ProviderLogo, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { formatCompact } from '../../shared/format';
import { SETTINGS_ICONS } from '../settings-icons';
import { BreakdownTable } from './breakdown-table';
import { ProjectCap } from './project-cap';
import type { UsageView } from './usage-search';
import { jobName, OTHER_UNITS, providerLabel, unitAmount } from './usage-words';

type Group = UsageSummary['byModule'][number];

/**
 * Billed units when there are any (characters, seconds, images), else tokens in and out. The tokens may break onto
 * two lines rather than push the share column out of the table: Spanish and Portuguese say "in" and "out" in two
 * words each.
 */
function used(i18n: I18n, row: Pick<Group, 'inputTokens' | 'outputTokens' | 'units'>): ReactNode {
  const units = OTHER_UNITS.filter((unit) => (row.units[unit] ?? 0) > 0);
  if (units.length > 0)
    return units.map((unit) => (
      <span key={unit} className="block whitespace-nowrap">
        {unitAmount(i18n, unit, row.units[unit] ?? 0)}
      </span>
    ));
  if (row.inputTokens + row.outputTokens === 0) return '–';
  const sent = formatCompact(i18n, row.inputTokens);
  const received = formatCompact(i18n, row.outputTokens);
  return (
    <span className="block text-balance">
      <Trans>
        {sent} in · {received} out
      </Trans>
    </span>
  );
}

export function Breakdowns({
  summary,
  view,
  projectNames,
  stale,
  onFilter,
}: {
  summary: UsageSummary;
  view: UsageView;
  projectNames: ReadonlyMap<ProjectId, string>;
  stale: boolean;
  onFilter: (change: Partial<Pick<UsageView, 'module' | 'provider' | 'project'>>) => void;
}) {
  const { t, i18n } = useLingui();
  const total = summary.totals.costUsd;

  const jobs = summary.byModule.map((row) => ({
    key: row.module,
    name: jobName(i18n, row.module),
    sortName: jobName(i18n, row.module),
    calls: row.calls,
    costUsd: row.costUsd,
    used: used(i18n, row),
  }));
  const providers = summary.byProvider.map((row) => {
    const name = providerLabel(i18n, row.provider, row.local);
    return {
      key: row.provider,
      name: (
        <span className="inline-flex items-center gap-2">
          <ProviderLogo provider={row.local ? 'on-device' : row.provider} size="sm" />
          {name ?? row.provider}
        </span>
      ),
      sortName: name ?? row.provider,
      asWritten: name === null,
      calls: row.calls,
      costUsd: row.costUsd,
      used: used(i18n, row),
    };
  });
  const projects = summary.byProject.map((row) => {
    const name = row.projectId ? (projectNames.get(row.projectId) ?? t`A project that was deleted`) : null;
    return {
      key: row.projectId ?? ('none' as const),
      name: name ? (
        <span data-user-content={row.projectId && projectNames.has(row.projectId) ? '' : undefined}>
          {name}
        </span>
      ) : (
        t`Not in a project`
      ),
      sortName: name ?? t`Not in a project`,
      asWritten: row.projectId !== null && projectNames.has(row.projectId),
      fixed: row.projectId === null,
      calls: row.calls,
      costUsd: row.costUsd,
      used: used(i18n, row),
      detail: row.projectId ? <ProjectCap projectId={row.projectId} /> : undefined,
    };
  });

  return (
    <>
      <PageSection title={<Trans>By job</Trans>} icon={SETTINGS_ICONS.jobs}>
        <BreakdownTable
          label={t`Spend by job`}
          nameHeading={t`Job`}
          rows={jobs}
          total={total}
          active={view.module}
          stale={stale}
          onSelect={(key) => onFilter({ module: key })}
        />
      </PageSection>
      <PageSection title={<Trans>By provider</Trans>} icon={CONCEPT_ICONS.model}>
        <BreakdownTable
          label={t`Spend by provider`}
          nameHeading={t`Provider`}
          rows={providers}
          total={total}
          active={view.provider}
          stale={stale}
          onSelect={(key) => onFilter({ provider: key })}
        />
      </PageSection>
      <PageSection
        title={<Trans>By project</Trans>}
        icon={CONCEPT_ICONS.project}
        actions={
          <Button asChild variant="ghost" size="sm" icon={VERB_ICONS.edit}>
            <Link to="/settings/usage/budgets" search={true}>
              <Trans>Change budgets</Trans>
            </Link>
          </Button>
        }
      >
        <BreakdownTable
          label={t`Spend by project`}
          nameHeading={t`Project`}
          rows={projects}
          total={total}
          active={view.project}
          stale={stale}
          onSelect={(key) => onFilter({ project: key === 'none' ? null : key })}
        />
      </PageSection>
    </>
  );
}
