// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TimeRange: a start and a duration, as in OpenTimelineIO. The end is
 * exclusive: a 10-frame range starting at frame 0 covers frames 0 to 9.
 * Start and duration always share one rate, so the end is exact.
 */
import { z } from 'zod';
import { FrameRateValue, type FrameRate } from './frame-rate-value';
import { RationalTime, rationalTimeSchema } from './rational-time';
import type { Rounding } from './rational';

export interface TimeRange {
  readonly start: RationalTime;
  /** Never negative. Zero is an empty range. */
  readonly duration: RationalTime;
}

function of(start: RationalTime, duration: RationalTime): TimeRange {
  if (duration.value < 0)
    throw new RangeError(`TimeRange duration must not be negative, got ${duration.value}`);
  if (FrameRateValue.equals(start.rate, duration.rate)) return { start, duration };
  const rate = FrameRateValue.common(start.rate, duration.rate);
  return { start: RationalTime.rescale(start, rate), duration: RationalTime.rescale(duration, rate) };
}

/** From a start and an exclusive end. The end must not be before the start. */
function fromStartEnd(start: RationalTime, end: RationalTime): TimeRange {
  const duration = RationalTime.subtract(end, start);
  return of(RationalTime.rescale(start, duration.rate), duration);
}

/** The exclusive end: the first instant after the range. */
function end(range: TimeRange): RationalTime {
  return RationalTime.add(range.start, range.duration);
}

const isEmpty = (range: TimeRange): boolean => range.duration.value === 0;

/** start <= time < end. An empty range contains nothing. */
function contains(range: TimeRange, time: RationalTime): boolean {
  return RationalTime.compare(range.start, time) <= 0 && RationalTime.isBefore(time, end(range));
}

/** True when every instant of `inner` is inside `outer`. An empty inner range must sit within outer's bounds. */
function containsRange(outer: TimeRange, inner: TimeRange): boolean {
  return (
    RationalTime.compare(outer.start, inner.start) <= 0 && RationalTime.compare(end(inner), end(outer)) <= 0
  );
}

/** True when the ranges share at least one instant. Ranges that only touch do not overlap. */
function overlaps(a: TimeRange, b: TimeRange): boolean {
  if (isEmpty(a) || isEmpty(b)) return false;
  return RationalTime.isBefore(a.start, end(b)) && RationalTime.isBefore(b.start, end(a));
}

/** The shared part, or undefined when the ranges don't overlap. */
function intersection(a: TimeRange, b: TimeRange): TimeRange | undefined {
  if (!overlaps(a, b)) return undefined;
  return fromStartEnd(RationalTime.max(a.start, b.start), RationalTime.min(end(a), end(b)));
}

/** The smallest range covering both (including any gap between them). */
function span(a: TimeRange, b: TimeRange): TimeRange {
  return fromStartEnd(RationalTime.min(a.start, b.start), RationalTime.max(end(a), end(b)));
}

/** Moves the range by `offset`, keeping its duration. */
function shift(range: TimeRange, offset: RationalTime): TimeRange {
  return of(RationalTime.add(range.start, offset), range.duration);
}

/**
 * The range at another rate. Start and end are rounded separately, so ranges
 * that touched before still touch after.
 */
function rescale(range: TimeRange, rate: FrameRate, rounding: Rounding = 'round'): TimeRange {
  return fromStartEnd(
    RationalTime.rescale(range.start, rate, rounding),
    RationalTime.rescale(end(range), rate, rounding),
  );
}

/** Same instants, whatever the rates. */
function equals(a: TimeRange, b: TimeRange): boolean {
  return RationalTime.equals(a.start, b.start) && RationalTime.equals(a.duration, b.duration);
}

export const TimeRange = {
  of,
  fromStartEnd,
  end,
  isEmpty,
  contains,
  containsRange,
  overlaps,
  intersection,
  span,
  shift,
  rescale,
  equals,
};

export const timeRangeSchema = z
  .object({ start: rationalTimeSchema, duration: rationalTimeSchema })
  .refine((range) => range.duration.value >= 0, {
    message: 'Duration must not be negative',
    path: ['duration'],
  })
  .transform((range): TimeRange => of(range.start, range.duration));
