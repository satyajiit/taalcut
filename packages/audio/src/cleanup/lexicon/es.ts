// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Spanish fillers (SPEC P3.7). "este" and "pues" are words too, so they are only reported. */
export const ES = {
  fillers: ['eh', 'em', 'mmm', 'mm', 'ehm'],
  ambiguous: ['este', 'pues', 'o sea', 'bueno', 'entonces', 'tipo'],
} as const;
