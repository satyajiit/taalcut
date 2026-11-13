// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { CONTACT_CHIPS, type ContactChip, type ContactChipId } from '#content/contact';
import type { ContactTopic } from '#lib/firebase/entries';

/**
 * The contact thread's topics, pure so they have a test. A chip is what the visitor picks; the message is stored under
 * the chip's own name (CONTACT_TOPICS and firestore.rules list all five), or `hello` when none is picked.
 */
export function storedTopic(chip: ContactChipId | null): ContactTopic {
  return chip ?? 'hello';
}

export function isChipId(value: unknown): value is ContactChipId {
  return typeof value === 'string' && CONTACT_CHIPS.some((c) => c.id === value);
}

/** The chip an address names (`?topic=privacy`), or null. Case and spaces don't matter. */
export function chipFromSearch(search: string): ContactChipId | null {
  const asked = new URLSearchParams(search).get('topic')?.trim().toLowerCase();
  return isChipId(asked) ? asked : null;
}

export function chipById(id: ContactChipId): ContactChip {
  return CONTACT_CHIPS.find((c) => c.id === id) ?? (CONTACT_CHIPS[0] as ContactChip);
}

/**
 * The chip a key press moves to in the topics' radio group (APG radio group): arrows wrap, Home and End jump, and any
 * other key stays. Pure, for the test.
 */
export function chipAfterKey(current: ContactChipId | null, key: string): ContactChipId | null {
  const ids = CONTACT_CHIPS.map((c) => c.id);
  const at = current === null ? -1 : ids.indexOf(current);
  const last = ids.length - 1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return ids[at >= last ? 0 : at + 1] ?? null;
    case 'ArrowLeft':
    case 'ArrowUp':
      return ids[at <= 0 ? last : at - 1] ?? null;
    case 'Home':
      return ids[0] ?? null;
    case 'End':
      return ids[last] ?? null;
    default:
      return null;
  }
}
