// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { cataloguePath } from './paths.ts';
import { parsePo } from './po.ts';
import { checkReview, entryFlags, needsReview, translatorNotes } from './review.ts';

const CATALOGUE = [
  '# review: is “clip” the word creators use?',
  '#: src/a.tsx',
  '#, fuzzy',
  'msgid "Clip"',
  'msgstr "क्लिप"',
  '',
  '#, fuzzy',
  'msgid "Untranslated"',
  'msgstr ""',
  '',
  '#: src/b.tsx',
  'msgid "Reviewed"',
  'msgstr "देख लिया"',
  '',
].join('\n');

function rootWith(status: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-review-'));
  for (const locale of ['en', 'hi']) {
    mkdirSync(join(cataloguePath(root, locale), '..'), { recursive: true });
    writeFileSync(cataloguePath(root, locale), locale === 'hi' ? CATALOGUE : 'msgid "Clip"\nmsgstr "Clip"\n');
  }
  writeFileSync(join(root, 'apps/renderer/src/locales/status.json'), JSON.stringify(status));
  return root;
}

describe('review flags', () => {
  it('reads the flag and the drafter’s notes of an entry', () => {
    const [clip, , reviewed] = parsePo(CATALOGUE).entries;
    expect(clip && entryFlags(clip)).toEqual(['fuzzy']);
    expect(clip && needsReview(clip)).toBe(true);
    expect(clip && translatorNotes(clip)).toEqual(['review: is “clip” the word creators use?']);
    expect(reviewed && needsReview(reviewed)).toBe(false);
  });

  it('counts the drafts of a draft catalogue, leaving out untranslated messages', () => {
    const root = rootWith({ en: 'signed-off', hi: 'draft' });
    const result = checkReview(root, JSON.stringify({ en: 'signed-off', hi: 'draft' }));
    expect(result.errors).toEqual([]);
    expect(result.summaries).toEqual([
      'apps/renderer/src/locales/hi/messages.po: 1 translation(s) flagged for native review, 1 with a reviewer note',
    ]);
  });

  it('fails a signed-off catalogue that still has a draft', () => {
    const status = { en: 'signed-off', hi: 'signed-off' };
    const result = checkReview(rootWith(status), JSON.stringify(status));
    expect(result.summaries).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ id: 'Clip', line: 4 });
    expect(result.errors[0]?.message).toMatch(/signed-off catalogue has no draft left/);
  });
});
