// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: spend by day (stacked columns, emphasis form) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.6 + UX4
 * one column per day, stacked by job in a fixed order with a 2 px canvas gap between parts, 4 px rounded top,
 *   square at the baseline, at most 24 px wide; the job in focus in primary-strong (selection), every other part
 *   neutral (rule-strong, 3:1 on every surface); hairline gridlines at 0, half and the top; money ticks in ink-3.
 *   No categorical palette: the kit's accents each mean something (DESIGN.md), so identity is the legend, the
 *   tooltip and the table, never colour alone (dataviz "emphasis").
 * states: default · hover (the day's band lifts, its tooltip shows) · focus (the chart's ring; arrows move the
 *   day; the day is announced) · active (n/a: reading only) · disabled (n/a) · loading (stale: the frame holds,
 *   dimmed by StaleContent) · error (the section's LoadError) · success (the numbers are the answer)
 * motion: none; reduced motion: nothing to reduce
 * contrast: primary-strong and rule-strong ≥ 3:1 on raised/canvas in light and dark (validated: ΔE 12.8 deutan)
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { StaleContent } from '@taalcut/ui';
import { useId } from 'react';
import { DayAxis, MoneyAxis } from './spend-chart-axes';
import { DayColumn, DayTooltip } from './spend-chart-columns';
import { dayDate, type SeriesKey, type SpendSeries } from './spend-series';
import { useDayCursor } from './use-day-cursor';
import { moneyShort } from './usage-words';

export interface SpendChartProps {
  readonly series: SpendSeries;
  /** The job drawn in the accent; null: every part neutral. */
  readonly emphasis: SeriesKey | null;
  readonly nameOf: (key: SeriesKey) => string;
  /** The numbers belong to the previous view; new ones are on their way. */
  readonly stale?: boolean;
}

export function SpendChart({ series, emphasis, nameOf, stale = false }: SpendChartProps) {
  const { t, i18n } = useLingui();
  const liveId = useId();
  const { days, top } = series;
  const cursor = useDayCursor(days.length);
  const { active } = cursor;
  const at = active === null ? null : days[active];

  let spoken = '';
  if (at) {
    const date = i18n.date(dayDate(at.day), { dateStyle: 'medium' });
    const spent = moneyShort(i18n, at.costUsd);
    spoken = t`${date}: ${spent}, ${plural(at.calls, { one: '# request', other: '# requests' })}.`;
  }

  return (
    <StaleContent stale={stale} asChild>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
          <MoneyAxis top={top} />
          <div
            role="group"
            tabIndex={0}
            aria-label={t`Spend by day. Use the arrow keys to read each day.`}
            aria-describedby={liveId}
            {...cursor.group}
            className="relative h-48 rounded-sm"
            data-slot="spend-chart"
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-rule-subtle" />
            <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-rule-subtle" />
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-rule" />
            <div aria-hidden className="absolute inset-0 flex items-stretch">
              {days.map((day, index) => (
                <DayColumn
                  key={day.day}
                  day={day}
                  top={top}
                  lifted={index === active}
                  emphasis={emphasis}
                  onEnter={() => cursor.enter(index)}
                />
              ))}
            </div>
            {at && active !== null ? (
              <DayTooltip day={at} index={active} count={days.length} emphasis={emphasis} nameOf={nameOf} />
            ) : null}
          </div>
        </div>
        <DayAxis days={days} top={top} />
        <p id={liveId} aria-live="polite" className="sr-only">
          {spoken}
        </p>
      </div>
    </StaleContent>
  );
}
