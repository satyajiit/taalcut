// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: spend by day as a table (the chart's twin) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.6 + UX4
 * the same numbers as the chart: a row per day (newest first), the day's total and each job's part, in the
 *   chart's job order. Always in the page for screen readers (visually hidden), shown when "Show as table" is on.
 * states: default · hover (row wash) · focus (the scroll region's ring) · active/disabled (n/a: reading only)
 *   · loading (stale: dimmed by StaleContent, as the chart) · error (the section's) · success (n/a)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { cn, StaleContent } from '@taalcut/ui';
import { dayDate, type SeriesKey, type SpendSeries } from './spend-series';
import { moneyShort } from './usage-words';

// type-caption in its own case: an uppercase header does nothing for Hindi.
const HEAD = 'bg-well px-3 py-2 type-caption whitespace-nowrap text-ink-3';
const CELL = 'border-t border-rule-subtle px-3 py-2 text-right whitespace-nowrap type-data';

export function SpendTable({
  series,
  nameOf,
  visible,
  stale = false,
}: {
  series: SpendSeries;
  nameOf: (key: SeriesKey) => string;
  /** Shown (Show as table), or only for screen readers beside the chart. */
  visible: boolean;
  stale?: boolean;
}) {
  const { t, i18n } = useLingui();
  const rows = series.days.filter((day) => day.calls > 0).toReversed();
  const table = (
    <table className="w-full min-w-[28rem] border-collapse text-left type-body">
      <caption className="sr-only">
        <Trans>Spend by day, newest first</Trans>
      </caption>
      <thead>
        <tr>
          <th scope="col" className={HEAD}>
            {t`Day`}
          </th>
          <th scope="col" className={cn(HEAD, 'text-right')}>
            {t`Requests`}
          </th>
          <th scope="col" className={cn(HEAD, 'text-right')}>
            {t`Spent`}
          </th>
          {series.keys.map((key) => (
            <th key={key} scope="col" className={cn(HEAD, 'text-right')}>
              {nameOf(key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((day) => (
          <tr key={day.day} className="transition-colors hover:bg-hover/50">
            <th
              scope="row"
              className="border-t border-rule-subtle px-3 py-2 font-medium whitespace-nowrap text-ink"
            >
              <time dateTime={day.day} className="font-sans">
                {i18n.date(dayDate(day.day), { dateStyle: 'medium' })}
              </time>
            </th>
            <td className={cn(CELL, 'text-ink-2')}>{i18n.number(day.calls)}</td>
            <td className={cn(CELL, 'font-medium text-ink')}>{moneyShort(i18n, day.costUsd)}</td>
            {day.parts.map((part) => (
              <td key={part.key} className={cn(CELL, 'text-ink-2')}>
                {part.costUsd > 0 ? moneyShort(i18n, part.costUsd) : '–'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (!visible) return <div className="sr-only">{table}</div>;
  return (
    <StaleContent stale={stale} asChild>
      <div
        role="region"
        aria-label={t`Spend by day, as a table`}
        tabIndex={0}
        data-scroll-x
        data-slot="spend-table"
        className="overflow-x-auto rounded-lg border border-rule-subtle bg-raised scrollbar-thin"
      >
        {table}
        {rows.length === 0 ? (
          <p className="m-0 border-t border-rule-subtle px-3 py-5 type-body text-ink-2">
            <Trans>No requests in this period.</Trans>
          </p>
        ) : null}
      </div>
    </StaleContent>
  );
}
