// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** English fillers: only the unambiguous ones are removed automatically (SPEC P3.7). */
export const EN = {
  fillers: ['uh', 'um', 'umm', 'er', 'erm', 'ah', 'hmm', 'mm'],
  ambiguous: ['like', 'so', 'you know', 'i mean', 'basically', 'actually', 'right', 'well'],
} as const;
