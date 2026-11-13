// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { REVIEW_FLAG, entryFlags } from './review.ts';
import { PoSyntaxError, quotePo, type PoComment, type PoEntry } from './po.ts';

/** What a returned catalogue owns for one message: the translation, its review flag, its translator comments. */
export interface EntryUpdate {
  entry: PoEntry;
  msgstr: string;
  /** True flags the translation for native review (`#, fuzzy`); false clears it; undefined leaves it. */
  review?: boolean;
  /** Replaces the translator comments (`# …`); undefined leaves them. */
  notes?: string[];
}

// Lingui writes an entry's comments in this order (pofile-ts stringifyItem), so a rewrite doesn't drift.
const ORDER: readonly PoComment['kind'][] = ['other', 'translator', 'reference', 'flag', 'previous'];

function flagLine(entry: PoEntry, review: boolean | undefined): string | undefined {
  let flags = entryFlags(entry);
  if (review === true && !flags.includes(REVIEW_FLAG)) flags = [...flags, REVIEW_FLAG];
  if (review === false) flags = flags.filter((flag) => flag !== REVIEW_FLAG);
  return flags.length > 0 ? `#, ${flags.join(',')}` : undefined;
}

function commentLines(update: EntryUpdate): string[] {
  const { entry } = update;
  const lines: string[] = [];
  for (const kind of ORDER) {
    if (kind === 'other' && update.notes !== undefined) {
      lines.push(...update.notes.map((note) => (note === '' ? '#' : `# ${note}`)));
      continue;
    }
    if (kind === 'flag') {
      const line = flagLine(entry, update.review);
      if (line) lines.push(line);
      continue;
    }
    lines.push(...entry.comments.filter((comment) => comment.kind === kind).map((comment) => comment.raw));
  }
  return lines;
}

/**
 * Rewrites each entry's comments and msgstr in place, keeping its msgctxt and msgid lines byte for byte.
 * The rest of the file is untouched.
 */
export function writeEntries(text: string, updates: EntryUpdate[]): string {
  const ordered = [...updates].sort((a, b) => b.entry.start - a.entry.start);
  let next = text;
  for (const update of ordered) {
    const { start, keywordStart, msgstrStart, msgstrEnd, msgstrLine } = update.entry;
    if (start < 0 || keywordStart < start || msgstrStart < keywordStart || msgstrEnd > next.length) {
      throw new PoSyntaxError(msgstrLine, 'catalogue entry span is unusable');
    }
    const keywords = next.slice(keywordStart, msgstrStart);
    const head = commentLines(update);
    const block = `${head.length > 0 ? `${head.join('\n')}\n` : ''}${keywords}msgstr ${quotePo(update.msgstr)}`;
    next = `${next.slice(0, start)}${block}${next.slice(msgstrEnd)}`;
  }
  return next;
}
