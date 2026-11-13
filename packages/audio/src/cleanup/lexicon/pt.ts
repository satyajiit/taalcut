// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Brazilian Portuguese fillers (SPEC P3.7). "né" and "tipo" carry meaning too, so they are only reported. */
export const PT = {
  fillers: ['ãh', 'ã', 'hum', 'hã', 'éé', 'ééé', 'eh'],
  ambiguous: ['tipo', 'né', 'então', 'assim', 'aí'],
} as const;
