// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type EntryUpdate, writeEntries } from './entry-writer.ts';
import { type Finding } from './finding.ts';
import { validateMessage } from './icu.ts';
import { cataloguePath, displayPath, isLocaleTag, PSEUDO_LOCALE, SOURCE_LOCALE } from './paths.ts';
import { placeholderProblem } from './placeholders.ts';
import { englishSource, entryKey, parsePo, PoSyntaxError, type PoEntry } from './po.ts';
import { needsReview, translatorNotes } from './review.ts';

export interface ImportResult {
  exitCode: number;
  errors: Finding[];
}

/** A returned file and the catalogue it merges into. */
interface Returned {
  incoming: string;
  target: string;
  english: string;
}

/** The hand-off's two files: the window's `<locale>.po` (required) and main's `<locale>.main.po`. */
function returnedFiles(root: string, locale: string, fromDir: string): Returned[] {
  return (['window', 'main'] as const).map((set) => ({
    incoming: join(fromDir, set === 'window' ? `${locale}.po` : `${locale}.main.po`),
    target: cataloguePath(root, locale, set),
    english: cataloguePath(root, SOURCE_LOCALE, set),
  }));
}

function indexEntries(entries: PoEntry[]): Map<string, PoEntry> | string {
  const map = new Map<string, PoEntry>();
  for (const entry of entries) {
    const key = entryKey(entry);
    if (map.has(key)) return `duplicate message id ${entry.id}`;
    map.set(key, entry);
  }
  return map;
}

function refused(file: string, id: string, message: string): ImportResult {
  return { exitCode: 1, errors: [{ file, line: 1, id, message }] };
}

/** The three catalogues one merge reads: what came back, the live catalogue (indexed) and the English. */
interface Catalogues {
  incoming: PoEntry[];
  targetText: string;
  target: Map<string, PoEntry>;
  english: Map<string, PoEntry>;
}

function readCatalogues(root: string, files: Returned): Catalogues | Finding {
  const shownTarget = displayPath(root, files.target);
  try {
    const targetText = readFileSync(files.target, 'utf8');
    const incoming = parsePo(readFileSync(files.incoming, 'utf8').replaceAll('\r\n', '\n')).entries;
    const target = indexEntries(parsePo(targetText).entries);
    const english = indexEntries(parsePo(readFileSync(files.english, 'utf8')).entries);
    if (typeof target === 'string') return { file: shownTarget, line: 1, id: '', message: target };
    if (typeof english === 'string') return { file: shownTarget, line: 1, id: '', message: english };
    return { incoming, targetText, target, english };
  } catch (error) {
    const syntax = error instanceof PoSyntaxError;
    const message = error instanceof Error ? error.message : 'could not read catalogues';
    return { file: syntax ? files.incoming : shownTarget, line: syntax ? error.line : 1, id: '', message };
  }
}

/** What is wrong with one returned translation of `source`: ICU, plurals, placeholders, line breaks. */
function translationProblems(msgstr: string, source: string, locale: string): string[] {
  const problems = validateMessage(msgstr, locale);
  const placeholderError = placeholderProblem(source, msgstr);
  if (placeholderError) problems.push(placeholderError);
  // Lingui writes a message with a line break over several lines; the source has none, so neither may this.
  if (msgstr.includes('\n') && !source.includes('\n'))
    problems.push('line break the English source does not have');
  return problems;
}

/** Validates one returned file; on success, the merged catalogue text to write. */
function merge(root: string, locale: string, files: Returned): { errors: Finding[]; text?: string } {
  const read = readCatalogues(root, files);
  if (!('incoming' in read)) return { errors: [read] };
  const errors: Finding[] = [];
  const updates: EntryUpdate[] = [];
  const seen = new Set<string>();
  for (const entry of read.incoming) {
    const key = entryKey(entry);
    const at = (line: number, message: string) =>
      errors.push({ file: files.incoming, line, id: entry.id, message });
    if (seen.has(key)) {
      at(entry.line, 'duplicate msgid');
      continue;
    }
    seen.add(key);
    const live = read.target.get(key);
    if (!live) at(entry.line, 'msgid changed or unknown; msgid changes are refused');
    // A blank msgstr is "not translated in this file". It never erases a translation already
    // imported, so a stale or partial hand-off cannot wipe work.
    if (!live || entry.msgstr === '') continue;
    const sourceEntry = read.english.get(key);
    const source = sourceEntry ? englishSource(sourceEntry) : entry.id;
    for (const message of translationProblems(entry.msgstr, source, locale)) at(entry.msgstrLine, message);
    // The returned file owns the translation, its review flag (a reviewer clears `fuzzy` on what they
    // approved) and the translator comments.
    updates.push({
      entry: live,
      msgstr: entry.msgstr,
      review: needsReview(entry),
      notes: translatorNotes(entry),
    });
  }
  if (errors.length > 0) return { errors };
  return { errors, text: writeEntries(read.targetText, updates) };
}

/**
 * Merges a translator's returned hand-off: `<locale>.po` into the window's catalogue and, when it is there,
 * `<locale>.main.po` into main's. Nothing is written unless every file is valid.
 */
export function importCatalogue(root: string, locale: string, fromDir: string): ImportResult {
  if (locale === SOURCE_LOCALE) return refused(fromDir, locale, 'refusing to import into en (source locale)');
  if (locale === PSEUDO_LOCALE)
    return refused(fromDir, locale, 'refusing to import into en-XA (pseudo-locale)');
  if (!isLocaleTag(locale)) return refused(fromDir, locale, `unknown locale ${locale}`);
  if (!existsSync(fromDir) || !statSync(fromDir).isDirectory())
    return refused(fromDir, locale, '--from must be a directory');
  const [window, main] = returnedFiles(root, locale, fromDir);
  if (!window || !existsSync(window.incoming))
    return refused(window?.incoming ?? fromDir, locale, 'returned catalogue is missing');
  const present = [window, ...(main && existsSync(main.incoming) ? [main] : [])];
  const merged = present.map((files) => ({ files, ...merge(root, locale, files) }));
  const errors = merged.flatMap((each) => each.errors);
  if (errors.length > 0) return { exitCode: 1, errors };
  for (const { files, text } of merged) if (text !== undefined) writeFileSync(files.target, text);
  return { exitCode: 0, errors: [] };
}
