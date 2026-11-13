// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-L10 keyword search: Devanagari words stay whole, Latin diacritics fold, user text is always quoted. */
import { RationalTime, TimeRange, unwrap, type ShotId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createRepositories,
  ftsQuery,
  keywordList,
  keywordMatches,
  parseSnippet,
  snippets,
  type LibraryDatabase,
} from '../../src/index';
import { openTestDb } from '../helpers';

const at = (value: number) => RationalTime.of(value, { num: 1000, den: 1 });

/** One asset per text, one shot each, the text as the shot's description (and speech when asked). */
function library(texts: readonly { description: string; speech?: string; file?: string }[]) {
  const db = openTestDb({ file: false });
  const repos = createRepositories(db);
  const source = unwrap(repos.sources.add({ kind: 'watched_folder', displayName: 'S', rootPath: '/s' }));
  const shots = texts.map((t, i) => {
    const asset = unwrap(
      repos.assets.create({ kind: 'video', sizeBytes: 10, originalFilename: t.file ?? `clip-${i}.mov` }),
    );
    unwrap(
      repos.assetLocations.add({
        assetId: asset.id,
        sourceId: source.id,
        storage: 'referenced',
        relativePath: `c${i}.mov`,
        sizeBytes: 10,
        state: 'present',
      }),
    );
    const [shotId] = unwrap(repos.shots.replaceForAsset(asset.id, 0, [TimeRange.of(at(0), at(5000))]));
    const model = { provider: 'test', model: 'test', local: true };
    unwrap(
      repos.shots.putDescriptions([
        { shotId: shotId!, description: { text: t.description, objects: [], model } },
      ]),
    );
    if (t.speech) {
      const words = t.speech
        .split(' ')
        .map((text, w) => ({ text, range: TimeRange.of(at(w * 100), at(100)) }));
      const segment = { text: t.speech, range: TimeRange.of(at(0), at(1000)), words, language: 'hi' };
      unwrap(
        repos.transcripts.put(
          asset.id,
          {
            version: 1,
            language: 'hi',
            segments: [segment],
            engine: 'whisper',
            model: 'm',
            local: true,
            wordTiming: 'native',
          },
          0,
        ),
      );
    }
    return shotId!;
  });
  return { db, shots };
}

function vocabulary(db: LibraryDatabase): string[] {
  db.driver.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS temp.shot_vocab USING fts5vocab(main, 'shot_fts', 'row')`,
  );
  return db.driver
    .prepare('SELECT term FROM temp.shot_vocab')
    .all()
    .map((r) => String(r.term));
}

describe('shot_fts tokenizer', () => {
  it('keeps a Devanagari word with its vowel signs and virama as one term', () => {
    const { db, shots } = library([
      { description: 'party', speech: 'नमस्ते दोस्तों' },
      { description: 'नमस घर' },
    ]);
    expect(vocabulary(db)).toEqual(expect.arrayContaining(['नमस्ते', 'दोस्तों', 'नमस']));
    expect(vocabulary(db)).not.toContain('त');
    expect(keywordMatches(db, 'नमस्ते', 10)).toEqual([shots[0]]);
    // The default tokenizer would have split "नमस्ते" into "नमस", "त" and matched both shots here.
    expect(keywordMatches(db, 'नमस', 10)).toEqual([shots[1]]);
  });

  it('folds Latin diacritics both ways', () => {
    const { db, shots } = library([
      { description: 'Skyline of São Paulo at dusk' },
      { description: 'Café da manhã' },
    ]);
    expect(keywordMatches(db, 'sao', 10)).toEqual([shots[0]]);
    expect(keywordMatches(db, 'SÃO paulo', 10)).toEqual([shots[0]]);
    expect(keywordMatches(db, 'cafe manha', 10)).toEqual([shots[1]]);
  });

  it('finds file names and keeps the index in step when a file is renamed', () => {
    const { db, shots } = library([{ description: 'x', file: 'goa-trip-day1.mov' }]);
    expect(keywordMatches(db, 'goa', 10)).toEqual([shots[0]]);
    const asset = unwrap(createRepositories(db).shots.get(shots[0]!)).assetId;
    db.driver.prepare('UPDATE assets SET original_filename = ? WHERE id = ?').run('kerala.mov', asset);
    expect(keywordMatches(db, 'goa', 10)).toEqual([]);
    expect(keywordMatches(db, 'kerala', 10)).toEqual([shots[0]]);
  });
});

describe('keyword hits', () => {
  it('carry the share of the query’s terms they hold, in bm25 order', () => {
    const { db, shots } = library([
      { description: 'chai shop in the monsoon rain' },
      { description: 'rain on the window' },
      { description: 'a quiet street' },
    ]);
    const list = keywordList(db, 'monsoon rain chai', 10);
    expect(list.map((m) => m.shotId)).toEqual([shots[0], shots[1]]);
    expect(list.map((m) => m.similarity)).toEqual([1, 1 / 3]);
    // One term: every hit holds all of it.
    expect(keywordList(db, 'rain', 10).map((m) => m.similarity)).toEqual([1, 1]);
    expect(keywordList(db, '!!!', 10)).toEqual([]);
  });
});

describe('the query', () => {
  it('never lets user text become FTS syntax', () => {
    const { db, shots } = library([{ description: 'beach day' }, { description: 'description market' }]);
    expect(ftsQuery('beach" OR description:* NEAR(a b) -x ^z')).toBe(
      '"beach" OR "description" OR "near" OR "b" OR "x" OR "z"',
    );
    for (const nasty of [
      '"',
      '*',
      'AND',
      'NOT beach',
      'description:beach',
      '(beach',
      '"unterminated',
      '{a b}',
    ]) {
      expect(() => keywordMatches(db, nasty, 10)).not.toThrow();
    }
    expect(keywordMatches(db, 'description:beach', 10)).toEqual(expect.arrayContaining(shots));
    expect(keywordMatches(db, '"""', 10)).toEqual([]);
    expect(ftsQuery('!!! ...')).toBeNull();
  });

  it('makes each term a quoted prefix when asked (memory search), and only then', () => {
    expect(ftsQuery('whi "pan')).toBe('"whi" OR "pan"');
    expect(ftsQuery('whi "pan', { prefix: true })).toBe('"whi"* OR "pan"*');
    expect(ftsQuery('!!!', { prefix: true })).toBeNull();
  });
});

describe('snippets', () => {
  it('are plain text with [start, end) highlights, from the field that matched best', () => {
    const { db, shots } = library([{ description: 'kids on the beach', speech: 'बीच पर बच्चे बीच' }]);
    const snippet = snippets(db, 'बीच', shots as ShotId[]).get(shots[0]!)!;
    expect(snippet.field).toBe('transcript');
    expect(snippet.highlights.map(([a, b]) => snippet.text.slice(a, b))).toEqual(['बीच', 'बीच']);
    expect(snippets(db, 'beach', shots).get(shots[0]!)!.field).toBe('description');
  });

  it('parse markers into UTF-16 ranges and drop stray ones', () => {
    expect(parseSnippet('a 😀b c d ')).toEqual({ text: 'a 😀b c d ', highlights: [[2, 5]] });
    const long = parseSnippet(`x${'y'.repeat(500)}`);
    expect(long.text).toHaveLength(400);
    expect(long.highlights).toEqual([[0, 1]]);
  });
});
