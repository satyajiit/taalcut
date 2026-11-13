// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The {…} texts a plan or a hub template writes in place of words (P3-V1, P3-B12): the Editor (agent) fills them
 * in the user's language. A hub template never carries the reference's own words, only the placeholder for each
 * overlay's role.
 */
import type { TEXT_ROLES } from './template-parts';

export const TEXT_PLACEHOLDERS = [
  '{title}',
  '{name}',
  '{point}',
  '{step}',
  '{problem}',
  '{benefit}',
  '{offer}',
  '{cta}',
  '{before}',
  '{after}',
  '{show}',
  '{guest}',
  '{place}',
  '{time}',
  '{label}',
  '{list}',
  '{caption}',
  '{other}',
] as const;
export type TextPlaceholder = (typeof TEXT_PLACEHOLDERS)[number];

/** What a hub template writes for an overlay of each role (docs/template-hub.md section 1). */
export const HUB_ROLE_PLACEHOLDERS = {
  title: '{title}',
  label: '{label}',
  list: '{list}',
  caption: '{caption}',
  cta: '{cta}',
  other: '{other}',
} as const satisfies Record<(typeof TEXT_ROLES)[number], TextPlaceholder>;

export function isPlaceholderText(text: string): text is TextPlaceholder {
  return (TEXT_PLACEHOLDERS as readonly string[]).includes(text);
}
