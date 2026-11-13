// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: a day's heading in the clip grid (UX4) · system: DESIGN.md v0.6 + UX4 (type roles, the kit's Checkbox)
 * LIB1-PLACE: the first day of a trip in the grid's order carries the trip's band above it (trips/trip-band.tsx),
 *   which scrolls away while the day's heading sticks.
 * the day in words ("Today", "Yesterday", "Sunday, Oct 12", the year when it isn't this one) in type-section, its
 *   clips counted in type-meta, and at its end "Select day", which shows while the day is pointed at, has focus
 *   within, or something is picked. It sticks under the window bar while its clips scroll under it, on the canvas,
 *   and the next day's heading pushes it away.
 * states: the box: unticked · ticked (every clip of the day picked) · mixed (some) · hover · focus · active
 *   (Checkbox's); the heading itself is words, no state
 * motion: none of its own; sticking is the browser's (position: sticky), nothing measured per frame */
import type { I18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Plural, useLingui } from '@lingui/react/macro';
import type { Trip } from '@taalcut/core';
import { Checkbox, cn, type CheckedState } from '@taalcut/ui';
import { DAY_HEADING, dayStartOf } from './day-layout';
import { TripBand } from './trips/trip-band';

const DAY_MS = 86_400_000;

/** The day as a machine reads it ("2026-10-12"), on the user's calendar. */
function isoDay(day: number): string {
  const date = new Date(day);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** A day as its heading says it: Today, Yesterday, else the weekday and the date (and the year, if not this one). */
export function dayHeadingWords(i18n: I18n, day: number, now: number): string {
  const today = dayStartOf(now);
  if (day === today) return i18n._(msg`Today`);
  // Midnight to midnight is 23 or 25 hours across a clock change: the day before is the day whose start is closest.
  if (Math.abs(today - DAY_MS - day) < DAY_MS / 2) return i18n._(msg`Yesterday`);
  const sameYear = new Date(day).getFullYear() === new Date(now).getFullYear();
  return i18n.date(new Date(day), {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export interface DayHeadingProps {
  id: string;
  day: number;
  count: number;
  now: number;
  /** The day's box: every clip picked, some, or none. */
  picked: CheckedState;
  /** Something is picked: every day shows its box. */
  selecting: boolean;
  /** The grid's tab stop is in this day: its box is in the tab order (Shift-Tab from the clip reaches it). */
  tabbable: boolean;
  onPick: (on: boolean) => void;
  /** The trip that starts here, in the grid's order: its band sits above the day. */
  trip?: Trip | null;
}

export function DayHeading(props: DayHeadingProps) {
  const { id, trip } = props;
  return (
    <>
      {trip ? <TripBand trip={trip} id={`${id}-trip`} /> : null}
      <DayLine {...props} />
    </>
  );
}

function DayLine({ id, day, count, now, picked, selecting, tabbable, onPick }: DayHeadingProps) {
  const { t, i18n } = useLingui();
  return (
    <div
      data-slot="clip-day-heading"
      // Never the scroll anchor: stuck, it doesn't move when words above the grid change height, so anchoring on it
      // would let the clips jump (a language switch, the import line growing).
      className="sticky top-0 z-[2] flex items-end gap-3 bg-canvas px-1 pb-2 [overflow-anchor:none]"
      style={{ height: DAY_HEADING }}
    >
      <h2 id={id} className="m-0 min-w-0 truncate type-section text-ink">
        <time dateTime={isoDay(day)}>{dayHeadingWords(i18n, day, now)}</time>
      </h2>
      <span className="shrink-0 pb-px type-meta text-ink-2 tabular-nums">
        <Plural value={count} one="# clip" other="# clips" />
      </span>
      <span
        className={cn(
          'ms-auto flex shrink-0 pb-0.5 transition-opacity duration-(--dur-micro) ease-(--ease-out)',
          selecting || picked !== false
            ? 'opacity-100'
            : 'opacity-0 group-hover/day:opacity-100 group-has-focus-visible/day:opacity-100',
        )}
      >
        <Checkbox
          checked={picked}
          onCheckedChange={(on) => onPick(on)}
          label={<span className="type-label-sm text-ink-2">{t`Select day`}</span>}
          aria-describedby={id}
          tabIndex={tabbable ? 0 : -1}
        />
      </span>
    </div>
  );
}
