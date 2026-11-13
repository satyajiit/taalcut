// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CaptionStyle } from '@taalcut/core';

/** Whether two caption looks are the same look, whatever their keys' order (a preset, or the person's own). */
export function sameLook(a: CaptionStyle, b: CaptionStyle): boolean {
  const keys = Object.keys(a) as (keyof CaptionStyle)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}
