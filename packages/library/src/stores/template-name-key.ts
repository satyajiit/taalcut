// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The key the template list's name sort orders by (`templates.name_key`, migration 24). SQLite's NOCASE folds
 * ASCII only, so "Árbol" sorted after "zebra"; SQLite has no collation that knows Unicode, and the key has to be
 * a plain column for keyset paging. So the key is computed here, on every write of a name and once for the
 * stored names by migration 24: compatibility decomposition (NFKD), the combining accents of Latin, Greek and
 * Cyrillic dropped, then lower case. "Árbol", "arbol" and "ARBOL" share a key and sort beside "apple"; "Éclair"
 * sorts among the e's. Only those accent blocks are dropped: Devanagari's vowel signs, virama and nukta are part
 * of the letter and stay, so Hindi names order by code point, which follows the varnamala. Ties go by id, as
 * every list sort does. At most 200 UTF-16 units (a list cursor carries the key), cut on a code point boundary.
 */

/** Combining Diacritical Marks, their Extended and Supplement blocks, marks for symbols, half marks. */
const ACCENT_BLOCKS: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];

function isAccent(codePoint: string): boolean {
  const value = codePoint.codePointAt(0) ?? 0;
  return ACCENT_BLOCKS.some(([first, last]) => value >= first && value <= last);
}

export const TEMPLATE_NAME_KEY_MAX = 200;

export function templateNameKey(name: string): string {
  let folded = '';
  for (const codePoint of name.normalize('NFKD')) if (!isAccent(codePoint)) folded += codePoint;
  const key = folded.toLowerCase();
  if (key.length <= TEMPLATE_NAME_KEY_MAX) return key;
  let cut = '';
  for (const codePoint of key) {
    if (cut.length + codePoint.length > TEMPLATE_NAME_KEY_MAX) break;
    cut += codePoint;
  }
  return cut;
}
