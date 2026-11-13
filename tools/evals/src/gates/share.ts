// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { proportionMeasured, type Measured } from './gate-metric';
import { wilson } from './stats';

/** A proportion and its Wilson interval. `n === 0` stays null, not zero. */
export function shareMeasured(successes: number, n: number, detail: string): Measured {
  const measured = proportionMeasured(successes, n, detail);
  if (n > 0) measured.interval = wilson(successes, n);
  return measured;
}
