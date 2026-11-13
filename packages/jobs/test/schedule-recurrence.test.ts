// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { nextScheduleOccurrence } from '../src/schedules/recurrence';

const daily = { weekdays: [0, 1, 2, 3, 4, 5, 6] };
const next = (timeZone: string, localTime: string, after: string, weekdays = daily.weekdays) => {
  const result = nextScheduleOccurrence({ timeZone, localTime, weekdays }, Date.parse(after));
  expect(result.ok).toBe(true);
  return result.ok ? new Date(result.value).toISOString() : '';
};

describe('calendar schedules', () => {
  it('keeps the chosen local time across a daylight-saving boundary', () => {
    expect(next('America/New_York', '09:00', '2026-03-07T15:00:00Z')).toBe('2026-03-08T13:00:00.000Z');
  });
  it('moves a nonexistent time forward by the spring gap', () => {
    expect(next('America/New_York', '02:30', '2026-03-08T00:00:00Z')).toBe('2026-03-08T07:30:00.000Z');
  });
  it('uses only the first repeated time, including when woken between the two', () => {
    expect(next('America/New_York', '01:30', '2026-11-01T00:00:00Z')).toBe('2026-11-01T05:30:00.000Z');
    expect(next('America/New_York', '01:30', '2026-11-01T05:45:00Z')).toBe('2026-11-02T06:30:00.000Z');
  });
  it('supports half-hour DST gaps and non-hour UTC offsets', () => {
    expect(next('Australia/Lord_Howe', '02:15', '2026-10-03T13:00:00Z')).toBe('2026-10-03T15:45:00.000Z');
    expect(next('Asia/Kolkata', '09:00', '2026-11-06T00:00:00Z')).toBe('2026-11-06T03:30:00.000Z');
  });
  it('skips missed dates and selects weekdays after the current instant', () => {
    expect(next('UTC', '09:00', '2026-11-06T12:00:00Z', [1])).toBe('2026-11-09T09:00:00.000Z');
    expect(next('UTC', '09:00', '2026-11-09T09:00:00Z', [1])).toBe('2026-11-16T09:00:00.000Z');
  });
  it('rejects invalid time zones and clocks as error values', () => {
    for (const value of [
      { timeZone: 'No/Such', localTime: '09:00' },
      { timeZone: 'UTC', localTime: '24:00' },
    ]) {
      expect(nextScheduleOccurrence({ ...daily, ...value }, Date.now()).ok).toBe(false);
    }
  });
});
