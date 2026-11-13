// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The looks a shot can have (video/looks.ts draws them); colour bars only where a clip asks for them. */
export const LOOKS = ['fractal', 'pattern', 'life', 'cells', 'gradient', 'pan', 'zoom'] as const;
export type Look = (typeof LOOKS)[number] | 'bars';
