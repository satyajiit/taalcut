// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The local days of a usage period: calendar days in the zone, clipped to the period, 23 or 25 h at a change. */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { dayBuckets, MAX_SUMMARY_DAYS } from '../../src/usage/day-buckets';

const HOUR = 3_600_000;

describe('dayBuckets', () => {
  it('cuts days at local midnight and clips the first and last day to the period', () => {
    // 2026-10-12 10:00 to 2026-10-14 05:00 in Kolkata (UTC+5:30).
    const from = Date.UTC(2026, 9, 12, 4, 30);
    const to = Date.UTC(2026, 9, 13, 23, 30);
    const days = unwrap(dayBuckets(from, to, 'Asia/Kolkata'));
    expect(days.map((d) => d.day)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(days[0]).toEqual({ day: '2026-10-12', start: from, end: Date.UTC(2026, 9, 12, 18, 30) });
    expect(days[1]).toEqual({
      day: '2026-10-13',
      start: Date.UTC(2026, 9, 12, 18, 30),
      end: Date.UTC(2026, 9, 13, 18, 30),
    });
    expect(days[2]).toEqual({ day: '2026-10-14', start: Date.UTC(2026, 9, 13, 18, 30), end: to + 1 });
  });

  it('makes a 23-hour and a 25-hour day where the clocks change', () => {
    // New York: clocks go forward on 2026-03-08 and back on 2026-11-01.
    const spring = unwrap(
      dayBuckets(Date.UTC(2026, 2, 7, 5), Date.UTC(2026, 2, 9, 4) - 1, 'America/New_York'),
    );
    expect(spring.map((d) => [d.day, (d.end - d.start) / HOUR])).toEqual([
      ['2026-03-07', 24],
      ['2026-03-08', 23],
    ]);
    const autumn = unwrap(
      dayBuckets(Date.UTC(2026, 9, 31, 4), Date.UTC(2026, 10, 2, 5) - 1, 'America/New_York'),
    );
    expect(autumn.map((d) => [d.day, (d.end - d.start) / HOUR])).toEqual([
      ['2026-10-31', 24],
      ['2026-11-01', 25],
    ]);
  });

  it('starts a day at the end of a gap when the clocks skip midnight', () => {
    // Santiago moves from 00:00 to 01:00 on 2026-09-06.
    const days = unwrap(dayBuckets(Date.UTC(2026, 8, 5, 4), Date.UTC(2026, 8, 7, 3) - 1, 'America/Santiago'));
    expect(days.map((d) => d.day)).toEqual(['2026-09-05', '2026-09-06']);
    expect(days[1]?.start).toBe(Date.UTC(2026, 8, 6, 4));
    expect(days.map((d) => (d.end - d.start) / HOUR)).toEqual([24, 23]);
  });

  it('keeps only the last days of a long period', () => {
    const to = Date.UTC(2026, 9, 12, 12);
    const days = unwrap(dayBuckets(0, to, 'UTC'));
    expect(days).toHaveLength(MAX_SUMMARY_DAYS);
    expect(days.at(-1)?.day).toBe('2026-10-12');
    expect(days[0]?.day).toBe('2025-09-08');
  });

  it('refuses an unknown time zone and a reversed range', () => {
    expect(dayBuckets(0, 1, 'Mars/Olympus').ok).toBe(false);
    expect(dayBuckets(2, 1, 'UTC').ok).toBe(false);
  });
});
