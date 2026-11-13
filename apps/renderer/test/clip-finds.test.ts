// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX4: ⌘K's clips for what is typed. Typing "goa" listed GX010610.MP4 and IMG_5258.MOV with nothing to say why:
// they were found by what is said in them ("we just landed in Goa"), on screen ("BEST THALI IN GOA") or by their
// place alone. A clip is now listed by its name, or with the passage that holds the words under its name; one
// found by a label the hit can't show is left to the Library's search.
import { i18n } from '@lingui/core';
import type { SearchHit } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { clipFinds } from '../src/features/palette/clip-finds';

i18n.loadAndActivate({ locale: 'en', messages: {} });

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

describe('⌘K’s clips', () => {
  it('lists a clip found for “goa” only by its name or with the passage that says Goa', async () => {
    const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
    const { hits } = await client.library.search({ query: 'goa', limit: 30 });
    // None of them is named for Goa: it is said in them, or on screen.
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => !fold(hit.asset.name).includes('goa'))).toBe(true);
    const finds = clipFinds(i18n, hits, 'goa', 5);
    expect(finds.length).toBeGreaterThan(0);
    expect(new Set(finds.map((find) => find.asset.id)).size).toBe(finds.length);
    for (const { asset, why } of finds) {
      if (fold(asset.name).includes('goa')) continue;
      expect(why, asset.name).toBeDefined();
      expect(['Said', 'On screen', 'Described']).toContain(why!.kind);
      const [start, end] = why!.marks![0]!;
      expect(fold(why!.passage.slice(start, end))).toBe('goa');
    }
  });

  it('leaves a clip found by its place alone to the Library’s search: nothing on the row could say why', async () => {
    const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
    const { hits } = await client.library.search({ query: 'palolem', limit: 30 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.snippet === undefined)).toBe(true);
    expect(clipFinds(i18n, hits, 'palolem', 5)).toEqual([]);
  });

  it('every snippet the fake gives marks the words it was found by', async () => {
    const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
    for (const query of ['goa', 'sunset beach', 'thali'])
      for (const hit of (await client.library.search({ query, limit: 30 })).hits)
        if (hit.snippet)
          expect(hit.snippet.highlights.length, `${query}: ${hit.snippet.text}`).toBeGreaterThan(0);
  });

  const asset = (id: string, name: string) => ({ id, name }) as SearchHit['asset'];
  const hit = (id: string, name: string, snippet?: SearchHit['snippet']) =>
    ({
      asset: asset(id, name),
      matchedBy: ['keyword'],
      score: 1,
      ...(snippet ? { snippet } : {}),
    }) as SearchHit;

  it('lists one row per clip, its best explained shot, and no more than asked', () => {
    const said: SearchHit['snippet'] = {
      field: 'transcript',
      text: 'we landed in Goa',
      highlights: [[13, 16]],
    };
    const finds = clipFinds(
      i18n,
      [
        hit('a', 'IMG_1.MOV'),
        hit('a', 'IMG_1.MOV', said),
        hit('b', 'Goa sunset.mov'),
        hit('c', 'IMG_3.MOV', said),
        hit('d', 'IMG_4.MOV', said),
      ],
      'Goa',
      3,
    );
    expect(finds.map((find) => [find.asset.id, find.why?.kind])).toEqual([
      ['a', 'Said'],
      ['b', undefined],
      ['c', 'Said'],
    ]);
  });

  it('starts a long passage a little before the word, so it shows on one line', () => {
    const text = `${'A long walk along the shore at dawn, past the boats and the nets drying, until '}Goa wakes up`;
    const at = text.indexOf('Goa');
    const [find] = clipFinds(
      i18n,
      [hit('a', 'IMG_1.MOV', { field: 'description', text, highlights: [[at, at + 3]] })],
      'goa',
      5,
    );
    const why = find!.why!;
    expect(why.kind).toBe('Described');
    expect(why.passage.startsWith('…')).toBe(true);
    const [start, end] = why.marks![0]!;
    expect(why.passage.slice(start, end)).toBe('Goa');
    expect(start).toBeLessThanOrEqual(26);
  });
});
