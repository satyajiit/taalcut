// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The local days of a usage period (G8): SQLite knows no time zones, so the days are cut here with Intl and the
 * SQL buckets each call by these instants. A day is [start, end) in epoch ms, clipped to the period (`to` is
 * inclusive). Days are calendar days in the zone, so a day around a clock change is 23 or 25 hours long.
 */
import { err, ok, ValidationError, type Result } from '@taalcut/core';

export interface DayBucket {
  /** Local date, 'YYYY-MM-DD'. */
  readonly day: string;
  readonly start: number;
  readonly end: number;
}

/** The most days a summary lists (usageSummarySchema.byDay): the period's last ones. */
export const MAX_SUMMARY_DAYS = 400;

const DAY_MS = 86_400_000;

interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

type ZoneClock = (at: number) => CivilDate & { readonly wallMs: number };

/** Reads an instant's wall-clock date and time in the zone; throws RangeError for an unknown zone. */
function zoneClock(timeZone: string): ZoneClock {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  return (at) => {
    const parts = Object.fromEntries(
      format.formatToParts(new Date(at)).map((part) => [part.type, Number(part.value)]),
    );
    const civil = { year: parts.year ?? 1970, month: parts.month ?? 1, day: parts.day ?? 1 };
    const wallMs = Date.UTC(
      civil.year,
      civil.month - 1,
      civil.day,
      parts.hour ?? 0,
      parts.minute ?? 0,
      parts.second ?? 0,
      ((at % 1000) + 1000) % 1000,
    );
    return { ...civil, wallMs };
  };
}

/** The instant the zone's clock reads 00:00 on `date` (or, in a gap, the first instant after it). */
function midnight(clock: ZoneClock, date: CivilDate): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day);
  const first = wall - (clock(wall).wallMs - wall);
  const second = wall - (clock(first).wallMs - first);
  const at = Math.min(first, second);
  // A zone whose clocks skip midnight starts that day at the end of the gap.
  return clock(at).day === date.day ? at : Math.max(first, second);
}

const nextDate = (date: CivilDate): CivilDate => {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
};

const label = (date: CivilDate): string =>
  `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

/** Every local day from `from` to `to` (inclusive), at most the last `maxDays`. */
export function dayBuckets(
  from: number,
  to: number,
  timeZone: string,
  maxDays = MAX_SUMMARY_DAYS,
): Result<DayBucket[]> {
  let clock: ZoneClock;
  try {
    clock = zoneClock(timeZone);
  } catch {
    return err(ValidationError({ field: 'timeZone' }, { detail: 'not an IANA time zone' }));
  }
  if (to < from) return err(ValidationError({ field: 'to' }, { detail: 'from is after to' }));
  const earliest = Math.max(from, to - (maxDays + 1) * DAY_MS);
  const days: DayBucket[] = [];
  let date: CivilDate = clock(earliest);
  let start = Math.max(from, midnight(clock, date));
  while (start <= to) {
    const following = nextDate(date);
    const end = Math.min(midnight(clock, following), to + 1);
    if (end > start) days.push({ day: label(date), start, end });
    date = following;
    start = end;
  }
  return ok(days.slice(-maxDays));
}
