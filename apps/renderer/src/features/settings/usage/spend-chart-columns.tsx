// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: spend by day, a day's column and its tooltip · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3
 * a column stacked by job in the series' fixed order, 2 px canvas gaps, 4 px rounded top, square at the baseline,
 *   at most 24 px wide; the job in focus in primary-strong, the rest rule-strong (ink-3 with nothing in focus).
 *   The tooltip sits beside the day inside the plot on the overlay surface: the date, the day's total, then each
 *   job's spend, the top of the stack first.
 * states: default · hover (the day's band lifts: hover wash) · focus (the chart's; the band follows the arrows)
 *   · active/disabled/loading/error (n/a: the chart's frame carries them) · success (the numbers)
 */
import { useLingui } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { DayLabel } from './spend-chart-axes';
import { markFill } from './spend-marks';
import type { DaySpend, SeriesKey } from './spend-series';
import { moneyShort } from './usage-words';

export function DayColumn({
  day,
  top,
  lifted,
  emphasis,
  onEnter,
}: {
  day: DaySpend;
  top: number;
  /** The day the pointer or the arrows are on. */
  lifted: boolean;
  emphasis: SeriesKey | null;
  onEnter: () => void;
}) {
  const height = top > 0 ? (day.costUsd / top) * 100 : 0;
  // A part under half a percent of the axis would be a 1 px stripe between two gaps: noise. It stays in the
  // tooltip and the table.
  const parts = day.parts.filter((part) => part.costUsd > 0 && part.costUsd >= top * 0.005);
  const drawn = parts.reduce((sum, part) => sum + part.costUsd, 0);
  return (
    <div
      data-day={day.day}
      onPointerEnter={onEnter}
      className={cn('flex min-w-0 flex-1 items-end justify-center px-px', lifted && 'bg-hover/70')}
    >
      {parts.length > 0 ? (
        <div
          className="flex w-full max-w-6 flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px]"
          style={{ height: `${Math.max(height, 1)}%` }}
        >
          {parts.map((part) => (
            <span
              key={part.key}
              data-part={part.key}
              className={cn('block min-h-px', markFill(emphasis === part.key, emphasis))}
              // Shares of what is drawn (they sum to 1: smaller grow factors leave part of the column empty).
              style={{ flexGrow: part.costUsd / drawn, flexBasis: 0 }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DayTooltip({
  day,
  index,
  count,
  emphasis,
  nameOf,
}: {
  day: DaySpend;
  /** The day's place in the series, and the series' length: where the tooltip sits. */
  index: number;
  count: number;
  emphasis: SeriesKey | null;
  nameOf: (key: SeriesKey) => string;
}) {
  const { i18n } = useLingui();
  const money = (value: number) => moneyShort(i18n, value);
  return (
    <div
      aria-hidden
      data-slot="spend-tooltip"
      className="pointer-events-none absolute top-1 z-10 flex w-max max-w-64 flex-col gap-1 rounded-md border border-rule bg-overlay px-3 py-2 type-meta shadow-md"
      // Beside the day, inside the plot: right of it in the first half, left of it in the second.
      style={
        index < count / 2
          ? { left: `calc(${((index + 1) / count) * 100}% + 8px)` }
          : { right: `calc(${100 - (index / count) * 100}% + 8px)` }
      }
    >
      <span className="text-ink-2">
        <DayLabel day={day.day} long />
      </span>
      <span className="type-card-title text-ink tabular-nums">{money(day.costUsd)}</span>
      {day.parts
        .filter((part) => part.costUsd > 0)
        .toReversed()
        .map((part) => (
          <span key={part.key} className="flex items-center gap-2 tabular-nums">
            <span
              className={cn(
                'h-0.5 w-3 shrink-0 rounded-pill',
                emphasis === part.key ? 'bg-primary-strong' : 'bg-ink-3',
              )}
            />
            <span className="font-medium text-ink">{money(part.costUsd)}</span>
            <span className="min-w-0 truncate text-ink-2">{nameOf(part.key)}</span>
          </span>
        ))}
    </div>
  );
}
