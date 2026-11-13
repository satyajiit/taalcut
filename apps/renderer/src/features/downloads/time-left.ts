// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n } from '@lingui/core';

/**
 * A download's time left in whole units, rounded up so it never says "0 sec" while bytes still arrive: seconds under
 * a minute, minutes under an hour, then hours. An estimate that changes every tick reads calmer without decimals.
 */
export function formatTimeLeft(i18n: I18n, ms: number): string {
  const unit = (value: number, name: 'second' | 'minute' | 'hour') =>
    i18n.number(value, { style: 'unit', unit: name, unitDisplay: 'short', maximumFractionDigits: 0 });
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return unit(seconds, 'second');
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return unit(minutes, 'minute');
  return unit(Math.ceil(minutes / 60), 'hour');
}
