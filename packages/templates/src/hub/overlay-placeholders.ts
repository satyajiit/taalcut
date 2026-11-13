// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hub overlays keep a role's placeholder and how long the original words were,
 * never the words (docs/template-hub.md section 1).
 */
import { HUB_ROLE_PLACEHOLDERS, type TEXT_ROLES } from '@taalcut/core';

export type HubTextRole = (typeof TEXT_ROLES)[number];

/** The `{…}` token a hub overlay of this role carries. */
export function placeholderFor(role: HubTextRole): (typeof HUB_ROLE_PLACEHOLDERS)[HubTextRole] {
  return HUB_ROLE_PLACEHOLDERS[role];
}

/**
 * Word and character counts of the reference text. The hub schema requires both
 * to be at least 1, so a non-empty string with no whitespace-separated word
 * still counts as one word.
 */
export function textMeasure(text: string): { readonly words: number; readonly chars: number } {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return { words: Math.max(1, words), chars: Math.max(1, text.length) };
}
