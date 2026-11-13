// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n } from '@lingui/core';
import { formatPercent } from '../shared/format';

/** A download's speed in the units Finder uses (powers of 1000): "8.4 MB/s". */
export function formatSpeed(i18n: I18n, bytesPerSecond: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let value = bytesPerSecond;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index += 1;
  }
  return i18n.number(value, {
    style: 'unit',
    unit: `${units[index] ?? 'byte'}-per-second`,
    unitDisplay: 'short',
    maximumFractionDigits: value < 10 && index > 0 ? 1 : 0,
  });
}

/** How far it got, 0 to 1; nothing to fetch counts as done. */
export function fractionOf(bytesDone: number, bytesTotal: number): number {
  if (bytesTotal <= 0) return 1;
  return Math.min(1, Math.max(0, bytesDone / bytesTotal));
}

/** The percent, rounded down: it never says 100% while bytes are still to come. */
export function formatProgress(i18n: I18n, fraction: number): string {
  return formatPercent(i18n, Math.floor(fraction * 100) / 100);
}
