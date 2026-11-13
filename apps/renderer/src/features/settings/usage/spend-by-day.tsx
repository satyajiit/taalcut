// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Usage › Spend by day · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.6 + UX4 (the kit's PageSection)
 * the section: a legend of jobs as toggle chips (the one pressed is drawn in the accent; a chip's swatch
 *   mirrors its mark), Show as table (the chart's twin, always in the page for screen readers), the chart; when
 *   one project is filtered, its budget meter sits above the chart (the cap bounds the project, not a day).
 * states: default · hover (chip ink) · focus (base ring) · active (pressed chip: selection wash) · disabled
 *   (n/a) · loading (stale: dimmed by StaleContent) · error (the page's LoadError) · success (the view is the
 *   answer)
 *   · empty (no spend in the period: one line, no chart)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { ProjectId, UsageSummary } from '@taalcut/core';
import { Button, CONCEPT_ICONS, PageSection } from '@taalcut/ui';
import { ChartColumnStacked, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { JobLegend } from './job-legend';
import { ProjectCap } from './project-cap';
import { SpendChart } from './spend-chart';
import { emphasisOf, spendSeries, type SeriesKey } from './spend-series';
import { SpendTable } from './spend-table';
import { jobName } from './usage-words';

/** Show as table or as chart: the chart's twin is always in the page for screen readers. */
function TableToggle({ asTable, onToggle }: { asTable: boolean; onToggle: () => void }) {
  return (
    <Button variant="ghost" size="sm" aria-pressed={asTable} onClick={onToggle} data-slot="show-as-table">
      {asTable ? <ChartColumnStacked aria-hidden /> : <Table2 aria-hidden />}
      {asTable ? <Trans>Show as chart</Trans> : <Trans>Show as table</Trans>}
    </Button>
  );
}

/** One project filtered: its cap bounds the project, not a day, so it sits above the chart. */
function ProjectBudget({ project }: { project: ProjectId }) {
  return (
    <div data-slot="project-budget" className="flex max-w-md flex-col gap-1.5">
      <p className="m-0 type-label text-ink">
        <Trans>This project’s budget, all time</Trans>
      </p>
      <ProjectCap projectId={project} />
    </div>
  );
}

function SpendDescription({ asTable }: { asTable: boolean }) {
  return asTable ? (
    <Trans>What each day cost, by job.</Trans>
  ) : (
    <Trans>What each day cost, by job. Point at a day, or focus the chart and use the arrow keys.</Trans>
  );
}

export function SpendByDay({
  summary,
  allTime,
  project,
  stale,
}: {
  summary: UsageSummary;
  /** All time: the chart starts at the first day with a call. */
  allTime: boolean;
  /** One project is filtered: its budget shows above the chart. */
  project: ProjectId | null;
  stale: boolean;
}) {
  const { t, i18n } = useLingui();
  const series = useMemo(() => spendSeries(summary, allTime), [summary, allTime]);
  const [asTable, setAsTable] = useState(false);
  // The biggest spender leads; a press moves the accent, a second press on it takes the accent away.
  const [chosen, setChosen] = useState<SeriesKey | 'none' | null>(null);
  const emphasis = emphasisOf(series.keys, chosen);
  const nameOf = (key: SeriesKey) => (key === 'other' ? t`Other jobs` : jobName(i18n, key));
  const spent = series.days.some((day) => day.costUsd > 0);

  return (
    <PageSection
      title={<Trans>Spend by day</Trans>}
      icon={CONCEPT_ICONS.date}
      description={spent ? <SpendDescription asTable={asTable} /> : null}
      actions={spent ? <TableToggle asTable={asTable} onToggle={() => setAsTable((on) => !on)} /> : null}
    >
      {project ? <ProjectBudget project={project} /> : null}
      {!spent ? (
        <p className="m-0 type-body text-ink-2">
          <Trans>Nothing was spent in this period.</Trans>
        </p>
      ) : (
        <>
          {series.keys.length > 1 && !asTable ? (
            <JobLegend keys={series.keys} emphasis={emphasis} nameOf={nameOf} onChoose={setChosen} />
          ) : null}
          {asTable ? null : <SpendChart series={series} emphasis={emphasis} nameOf={nameOf} stale={stale} />}
          <SpendTable series={series} nameOf={nameOf} visible={asTable} stale={stale} />
        </>
      )}
    </PageSection>
  );
}
