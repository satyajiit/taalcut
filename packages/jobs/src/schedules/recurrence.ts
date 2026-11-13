// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineError, err, ok, type Result } from '@taalcut/core';

export interface CalendarSchedule {
  readonly timeZone: string;
  readonly localTime: string;
  /** Sunday is zero. All seven days expresses a daily schedule. */
  readonly weekdays: readonly number[];
}

export const InvalidSchedule = defineError('jobs.invalid_schedule', { retryable: false });
const DAY = 86_400_000;
const MINUTE = 60_000;

function localParts(format: Intl.DateTimeFormat, instant: number): number[] {
  const parts = format.formatToParts(instant);
  return ['year', 'month', 'day', 'hour', 'minute'].map((name) =>
    Number(parts.find((part) => part.type === name)?.value),
  );
}

function localEpoch(parts: readonly number[]): number {
  return Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!);
}

/**
 * One occurrence per local date. A repeated clock time uses its first instant; a missing clock time moves
 * forward by the DST gap. Work missed while asleep is coalesced by advancing from now, not replayed per minute.
 */
export function nextScheduleOccurrence(schedule: CalendarSchedule, after: number): Result<number> {
  if (
    !Number.isFinite(after) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime) ||
    schedule.weekdays.length === 0 ||
    schedule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  )
    return err(InvalidSchedule({}));
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: schedule.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return err(InvalidSchedule({}));
  }
  const today = localParts(format, after);
  const [hour, minute] = schedule.localTime.split(':').map(Number);
  const midnight = Date.UTC(today[0]!, today[1]! - 1, today[2]!);
  for (let day = 0; day <= 8; day++) {
    const date = midnight + day * DAY;
    if (!schedule.weekdays.includes(new Date(date).getUTCDay())) continue;
    const wall = date + hour! * 60 * MINUTE + minute! * MINUTE;
    // Both sides of a transition, including half-hour transitions, without a minute-by-minute scan.
    const offsets = new Set(
      [-36, -12, 0, 12, 36].map((hours) => {
        const sample = wall + hours * 60 * MINUTE;
        return localEpoch(localParts(format, sample)) - sample;
      }),
    );
    const candidates = [...offsets].map((offset) => wall - offset);
    const exact = candidates.filter((instant) => localEpoch(localParts(format, instant)) === wall);
    const shifted = candidates.filter((instant) => {
      const local = localEpoch(localParts(format, instant));
      return local > wall && local < date + DAY;
    });
    const instant = exact.length ? Math.min(...exact) : Math.min(...shifted);
    if (Number.isFinite(instant) && instant > after) return ok(instant);
  }
  return err(InvalidSchedule({}));
}
