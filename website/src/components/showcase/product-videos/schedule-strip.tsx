// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a product's research schedule and limits, as one strip · mode: Operate · system: WEB2 Remix Vernacular
 *   (teal is your choice)
 * Products › Taalcut › Schedule (product-schedule.tsx, product-fields.tsx), kept to one quiet band under the
 *   ideas: Research this product on a schedule as a switch, the research days as seven small toggles, the time and
 *   time zone, when research runs next; then the limits in a line of words (a topic comes back after its days, a
 *   video a day, a budget a video) and where it runs (the installed app). The facts stay; the form look goes.
 * states: the switch: on (teal, the thumb across) · off (the days rest, Next says Off) · hover · focus · a day:
 *   chosen (teal, pressed) · not · hover · focus · disabled while the switch is off; the last chosen day stays
 *   chosen (research needs a day)
 * motion: the switch's thumb slides (transform, --dur-short); reduced motion: at once */

import { CalendarClock, Clock } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { nextResearchDay, SCHEDULE, WEEK } from './ideas';

export function ScheduleStrip({
  on,
  onSwitch,
  days,
  onDay,
}: {
  readonly on: boolean;
  readonly onSwitch: (on: boolean) => void;
  readonly days: readonly number[];
  readonly onDay: (day: number) => void;
}) {
  const id = useId();
  // The visitor's own today, once the page runs; the server's HTML counts from a Sunday, so Monday comes first.
  const [today, setToday] = useState(0);
  useEffect(() => setToday(new Date().getDay()), []);
  return (
    <section aria-labelledby={`${id}-switch`} className="flex min-w-0 flex-col gap-3 border-t border-rule-subtle pt-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          id={`${id}-switch`}
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => onSwitch(!on)}
          className="inline-flex items-center gap-2.5 rounded-pill py-1 pe-1 text-start type-label text-ink"
        >
          <CalendarClock aria-hidden strokeWidth={ICON_STROKE} className="size-4 shrink-0 text-ink-2" />
          Research this product on a schedule
          <span aria-hidden className={cn('relative inline-flex h-6 w-10 shrink-0 rounded-pill transition-colors duration-(--dur-short)', on ? 'bg-teal-strong' : 'bg-control-pressed')}>
            <span
              className={cn(
                'absolute top-0.5 left-0.5 size-5 rounded-pill bg-raised shadow-xs transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none',
                on && 'translate-x-4',
              )}
            />
          </span>
        </button>
        <fieldset className="m-0 flex min-w-0 items-center gap-1 border-0 p-0" disabled={!on}>
          <legend className="sr-only">Research days</legend>
          {WEEK.map((w) => {
            const chosen = days.includes(w.day);
            return (
              <button
                key={w.day}
                type="button"
                aria-pressed={chosen}
                onClick={() => onDay(w.day)}
                className={cn(
                  'inline-grid h-7 min-w-9 place-items-center rounded-pill px-1.5 type-caption font-semibold transition-colors duration-(--dur-micro) disabled:cursor-not-allowed',
                  chosen ? 'bg-teal-soft text-teal-strong' : 'text-ink-2 hover:bg-hover hover:text-ink',
                  !on && 'opacity-60',
                )}
              >
                {w.short}
              </button>
            );
          })}
        </fieldset>
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 type-meta text-ink-2">
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Clock aria-hidden className="size-3.5 shrink-0" />
            {SCHEDULE.time} · {SCHEDULE.timezone}
          </span>
          <span>
            Next research:{' '}
            <span role="status" className="font-semibold text-ink">
              {on ? `${nextResearchDay(days, today)}, ${SCHEDULE.time}` : 'Off'}
            </span>
          </span>
        </p>
      </div>
      <p className="m-0 type-meta text-pretty text-ink-2">
        A topic comes back after <span className="text-ink tabular-nums">{SCHEDULE.noveltyDays} days</span> · at most{' '}
        <span className="text-ink tabular-nums">{SCHEDULE.perDay} video a day</span> · a budget of{' '}
        <span className="text-ink tabular-nums">{SCHEDULE.budget} USD</span> a video · research runs in the installed app
      </p>
    </section>
  );
}
