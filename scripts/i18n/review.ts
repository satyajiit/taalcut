// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';

import { type Finding } from './finding.ts';
import { readStatus } from './missing.ts';
import { displayPath, localesDir, PSEUDO_LOCALE, SOURCE_LOCALE } from './paths.ts';
import { listCatalogueFiles, parsePo, PoSyntaxError, type PoEntry } from './po.ts';

/**
 * gettext's "needs work" flag (`#, fuzzy`). A draft translation carries it until a native speaker approves it
 * (H8); PO editors (Poedit, Weblate, Lokalize) show it and clear it when the reviewer accepts the string. Lingui
 * keeps flags through `extract` and compiles flagged translations as usual, so the app shows the draft meanwhile.
 */
export const REVIEW_FLAG = 'fuzzy';

/** A translator comment (`# review: …`) the drafter left for the native reviewer. Lingui keeps it on extract. */
export const REVIEW_NOTE_PREFIX = 'review:';

export function entryFlags(entry: Pick<PoEntry, 'comments'>): string[] {
  return entry.comments
    .filter((comment) => comment.kind === 'flag')
    .flatMap((comment) => comment.raw.slice(2).split(','))
    .map((flag) => flag.trim())
    .filter((flag) => flag !== '');
}

export function needsReview(entry: Pick<PoEntry, 'comments'>): boolean {
  return entryFlags(entry).includes(REVIEW_FLAG);
}

/** The entry's translator comments (`# …`), without the leading `#`. */
export function translatorNotes(entry: Pick<PoEntry, 'comments'>): string[] {
  return entry.comments
    .filter((comment) => comment.kind === 'other' && /^#(\s|$)/.test(comment.raw))
    .map((comment) => comment.raw.slice(1).trim());
}

export interface ReviewResult {
  errors: Finding[];
  /** One line per catalogue with drafts left: `<file>: N translation(s) flagged for native review`. */
  summaries: string[];
}

function isReviewNote(note: string): boolean {
  return note.startsWith(REVIEW_NOTE_PREFIX);
}

/** One catalogue's drafts: errors when its language is signed off, else a line saying how many are left. */
function reviewDrafts(shown: string, drafts: PoEntry[], signedOff: boolean): ReviewResult {
  if (signedOff) {
    const errors = drafts.map((entry) => ({
      file: shown,
      line: entry.line,
      id: entry.id,
      message: `still flagged ${REVIEW_FLAG}: a signed-off catalogue has no draft left`,
    }));
    return { errors, summaries: [] };
  }
  const notes = drafts.filter((entry) => translatorNotes(entry).some(isReviewNote)).length;
  const withNotes = notes > 0 ? `, ${notes} with a reviewer note` : '';
  return {
    errors: [],
    summaries: [`${shown}: ${drafts.length} translation(s) flagged for native review${withNotes}`],
  };
}

/**
 * A signed-off catalogue has no draft left: every flagged translation there is an error. Draft and in-review
 * catalogues report how many drafts are still waiting for the native reviewer.
 */
export function checkReview(root: string, statusText: string, dir: string = localesDir(root)): ReviewResult {
  const result: ReviewResult = { errors: [], summaries: [] };
  const parsedStatus = readStatus(statusText);
  if (!parsedStatus.ok) return result;
  for (const { locale, file } of listCatalogueFiles(dir)) {
    if (locale === SOURCE_LOCALE || locale === PSEUDO_LOCALE) continue;
    const shown = displayPath(root, file);
    let entries: PoEntry[];
    try {
      entries = parsePo(readFileSync(file, 'utf8')).entries;
    } catch (error) {
      const line = error instanceof PoSyntaxError ? error.line : 1;
      result.errors.push({ file: shown, line, id: '', message: 'could not parse catalogue' });
      continue;
    }
    const drafts = entries.filter((entry) => entry.msgstr !== '' && needsReview(entry));
    if (drafts.length === 0) continue;
    const found = reviewDrafts(shown, drafts, parsedStatus.status[locale] === 'signed-off');
    result.errors.push(...found.errors);
    result.summaries.push(...found.summaries);
  }
  return result;
}
