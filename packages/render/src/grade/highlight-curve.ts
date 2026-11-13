// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Grade } from '@taalcut/core';

/** A bounded shoulder: even at -1 its slope stays positive, so bright details never reverse. */
function shoulder(value: number, amount: number, start: number): number {
  const position = Math.max(0, Math.min(1, (value - start) / (1 - start)));
  const weight = position * position * (3 - 2 * position);
  return Math.max(0, Math.min(1, value + amount * (1 - start) * 0.5 * weight));
}

/** Display-referred adjustment; it softens clipped whites but cannot reconstruct lost detail. */
export function highlightChannel(value: number, grade: Pick<Grade, 'highlights' | 'whites'>): number {
  return shoulder(shoulder(value, grade.highlights ?? 0, 0.5), grade.whites ?? 0, 0.75);
}

/** The same browser compositor applies this table in preview and export. */
export function highlightTable(grade: Grade): string | null {
  if (!(grade.highlights ?? 0) && !(grade.whites ?? 0)) return null;
  return Array.from({ length: 65 }, (_, index) =>
    Number(highlightChannel(index / 64, grade).toFixed(6)),
  ).join(' ');
}
