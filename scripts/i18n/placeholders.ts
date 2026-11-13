// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Finding } from './finding.ts';
import { placeholderNames } from './icu.ts';
import { displayPath, localesDir, PSEUDO_LOCALE, SOURCE_LOCALE } from './paths.ts';
import { englishSource, entryKey, listCatalogueFiles, parsePo, PoSyntaxError } from './po.ts';

/**
 * Lingui rich-text tags: `<0>`, `</0>`, `<0/>`. A dropped tag loses a link or an emphasis.
 * Compared as sets: a plural branch the locale adds (es `many`) repeats the same tags.
 */
const TAG = /<\/?\d+\/?>/g;

function tags(text: string): string {
  return [...new Set([...text.matchAll(TAG)].map((match) => match[0]))]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .join(' ');
}

function difference(left: Iterable<string>, right: Set<string>): string[] {
  return [...left].filter((name) => !right.has(name));
}

/** Why a translation's placeholders or tags differ from the English source, or undefined. */
export function placeholderProblem(source: string, translation: string): string | undefined {
  const parts: string[] = [];
  const fromSource = placeholderNames(source);
  const fromTranslation = placeholderNames(translation);
  if (fromSource && fromTranslation) {
    const missing = difference(fromSource, fromTranslation);
    const extra = difference(fromTranslation, fromSource);
    if (missing.length > 0) parts.push(`missing ${missing.join(', ')}`);
    if (extra.length > 0) parts.push(`unexpected ${extra.join(', ')}`);
  }
  const sourceTags = tags(source);
  const translationTags = tags(translation);
  if (sourceTags !== translationTags) {
    parts.push(`tags ${translationTags || '(none)'} instead of ${sourceTags || '(none)'}`);
  }
  if (parts.length === 0) return undefined;
  return `placeholders must match the English source (${parts.join('; ')})`;
}

/** Every translated message in every catalogue keeps the English placeholders and tags. */
export function checkPlaceholders(root: string, dir: string = localesDir(root)): Finding[] {
  const englishFile = join(dir, SOURCE_LOCALE, 'messages.po');
  const english = new Map<string, string>();
  try {
    for (const entry of parsePo(readFileSync(englishFile, 'utf8')).entries) {
      english.set(entryKey(entry), englishSource(entry));
    }
  } catch {
    // Not swallowed: checkIcu reports an unreadable or unparsable English catalogue with its line.
    return [];
  }
  const findings: Finding[] = [];
  for (const { locale, file } of listCatalogueFiles(dir)) {
    if (locale === SOURCE_LOCALE || locale === PSEUDO_LOCALE) continue;
    let entries;
    try {
      entries = parsePo(readFileSync(file, 'utf8')).entries;
    } catch (error) {
      // checkIcu reports this catalogue's syntax error with its line. Anything else is unexpected.
      if (error instanceof PoSyntaxError) continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.msgstr === '') continue;
      const problem = placeholderProblem(english.get(entryKey(entry)) ?? entry.id, entry.msgstr);
      if (problem) {
        findings.push({
          file: displayPath(root, file),
          line: entry.msgstrLine,
          id: entry.id,
          message: problem,
        });
      }
    }
  }
  return findings;
}
