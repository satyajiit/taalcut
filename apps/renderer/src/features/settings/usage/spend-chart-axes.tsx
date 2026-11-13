// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: spend by day, the axes · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * the money axis (the top, half way and zero, in ink-3 with tabular figures, precise to the cent's fraction) and
 *   the day axis (the first, the last and a few between, dates from Intl in a <time> each). Both are read by the
 *   chart's focus announcement and the table twin, so they are hidden from screen readers.
 * states: n/a (static labels; the chart's frame carries loading and error)
 */
import { useLingui } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { formatUsd } from '../../shared/format';
import { dayDate, type DaySpend } from './spend-series';

/** Where the x axis names a day: the first, the last and a few between (never crowded). */
export function tickDays(count: number): Set<number> {
  if (count <= 8) return new Set(Array.from({ length: count }, (_, i) => i));
  const step = Math.ceil((count - 1) / 4);
  const ticks = new Set<number>([0, count - 1]);
  for (let i = step; i < count - step / 2; i += step) ticks.add(i);
  return ticks;
}

export function DayLabel({ day, long = false }: { day: string; long?: boolean }) {
  const { i18n } = useLingui();
  return (
    <time dateTime={day} className="font-sans">
      {i18n.date(dayDate(day), long ? { dateStyle: 'medium' } : { day: 'numeric', month: 'short' })}
    </time>
  );
}

/** A money tick keeps its precision: half of $0.05 is $0.025, not $0.03. */
function useTick(): (value: number) => string {
  const { i18n } = useLingui();
  return (value) => formatUsd(i18n, value);
}

/** The money axis: the top, half way and zero. */
export function MoneyAxis({ top }: { top: number }) {
  const tick = useTick();
  return (
    <div aria-hidden className="relative h-48 text-right type-caption text-ink-3 tabular-nums">
      <span className="block -translate-y-1/2">{tick(top)}</span>
      <span className="absolute right-0 top-1/2 -translate-y-1/2">{tick(top / 2)}</span>
      <span className="absolute right-0 bottom-0 translate-y-1/2">{tick(0)}</span>
    </div>
  );
}

/** Where a day's label sits: flush at the ends, centred under its column between them. */
function tickPlace(index: number, count: number): { className: string; left?: string } {
  if (index === 0) return { className: 'left-0' };
  if (index === count - 1) return { className: 'right-0' };
  return { className: '-translate-x-1/2', left: `${((index + 0.5) / count) * 100}%` };
}

/** The day axis, under the plot; its spacer is as wide as the money axis' widest tick. */
export function DayAxis({ days, top }: { days: readonly DaySpend[]; top: number }) {
  const tick = useTick();
  const ticks = tickDays(days.length);
  return (
    <div aria-hidden className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      <span className="invisible type-caption tabular-nums">
        {tick(top).length >= tick(top / 2).length ? tick(top) : tick(top / 2)}
      </span>
      <div className="relative h-4 type-caption text-ink-3">
        {days.map((day, index) => {
          if (!ticks.has(index)) return null;
          const place = tickPlace(index, days.length);
          return (
            <span
              key={day.day}
              className={cn('absolute top-0 whitespace-nowrap', place.className)}
              style={place.left === undefined ? undefined : { left: place.left }}
            >
              <DayLabel day={day.day} />
            </span>
          );
        })}
      </div>
    </div>
  );
}
