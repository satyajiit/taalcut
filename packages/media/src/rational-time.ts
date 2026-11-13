// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Media time, OpenTimelineIO style: `value` units at `rate` units per second.
 * 2.002 s at a 1/30000 time base is { value: 60060, rate: 30000 }.
 *
 * Not core's RationalTime, on purpose: this one keeps OTIO's single-number rate
 * (a stream's time base as probed), while core's rate is an exact `{ num, den }`
 * FrameRate. They are different types. Swapping this for core's would turn every
 * `value / rate` here and in its users (render's export style, transfer's USB
 * checks) into NaN, so convert at the edge instead (review L1).
 */
export interface RationalTime {
  readonly value: number;
  readonly rate: number;
}
