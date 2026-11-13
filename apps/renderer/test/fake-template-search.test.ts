// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL: the fake's templates.search (fake-template-search.ts): words only until the scenario says the Search
 * model is here, then meaning and slot intents too, fused best first; the view's scope narrows it; 'failing' times
 * out. And the Templates page's scope for a search (search-scope.ts).
 * LRN1-FIX: its words and the fake list's free text read as the library's do (template-terms.ts): search takes any
 * term, stopwords dropped; the list needs every word. A slot match carries its place and intent.
 */
import { callRpc, TEMPLATE_SEARCH_MAX_HITS, type TemplateSearchHit } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import type { FakeTemplateSearchScenario } from '../src/backend/fake/templates/fake-template-search';
import { listWords, queryTerms, tokensOf } from '../src/backend/fake/templates/template-terms';
import { searchScopeOf } from '../src/features/templates/search/search-scope';

const backendWith = (templateSearch?: FakeTemplateSearchScenario) =>
  createFakeBackend({ phase2: { ...(templateSearch ? { templateSearch } : {}) } }).client;

async function search(
  templateSearch: FakeTemplateSearchScenario | undefined,
  text: string,
  favourite?: boolean,
) {
  const result = await callRpc(
    backendWith(templateSearch).templates.search({ text, ...(favourite === undefined ? {} : { favourite }) }),
  );
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

const named = (hits: readonly TemplateSearchHit[], name: string) =>
  hits.find((hit) => hit.summary.name === name);

describe('the fake template search', () => {
  it('reads words only until the Search model is here, and says so', async () => {
    const found = await search(undefined, 'sea');
    expect(found.degraded).toBe('keyword-only');
    expect(named(found.hits, 'Golden hour market')?.matchedBy).toEqual(['words']);
    expect((await search(undefined, 'breakfast')).hits).toEqual([]);
  });

  it('finds by meaning and by a slot’s intent once the model is here, best first', async () => {
    const found = await search('ready', 'breakfast');
    expect(found.degraded).toBeNull();
    const morning = named(found.hits, 'Slow morning routine');
    expect(morning?.matchedBy).toEqual(['meaning', 'slot']);
    expect(morning?.slotId).not.toBeNull();
    // The slot as the template wrote it, by its place: "slot 7's intent: Café table, first sip".
    expect(morning?.slot).toEqual({ index: 6, intent: 'Café table, first sip' });
    expect(found.hits.map((hit) => hit.score)).toEqual(
      [...found.hits.map((hit) => hit.score)].sort((a, b) => b - a),
    );
    expect(found.hits.every((hit) => hit.score > 0 && hit.score <= 1)).toBe(true);
  });

  it('searches the view’s scope only', async () => {
    const names = (hits: readonly TemplateSearchHit[]) => hits.map((hit) => hit.summary.name);
    expect(names((await search('ready', 'breakfast')).hits)).toEqual([
      'Slow morning routine',
      'Golden hour market',
    ]);
    // Only Golden hour market is a favourite.
    expect(names((await search('ready', 'breakfast', true)).hits)).toEqual(['Golden hour market']);
  });

  it('finds by any of the words, stopwords dropped, where the list needs every word', async () => {
    const words = 'a close-up hook with text on screen';
    const client = backendWith();
    expect((await client.templates.list({ query: words, limit: 200 })).items).toEqual([]);
    const found = await search(undefined, words);
    expect(found.hits.map((hit) => hit.summary.name).sort()).toEqual([
      'Golden hour market',
      'Three-hook vlog opener',
    ]);
    // Each word is a prefix: "pour" finds "Pour-over coffee"; every word must be there for the list.
    expect(named((await search(undefined, 'pour')).hits, 'Slow morning routine')?.matchedBy).toEqual([
      'words',
    ]);
    expect((await client.templates.list({ query: 'pour coffee', limit: 200 })).items).toHaveLength(1);
    expect((await client.templates.list({ query: 'pour zebra', limit: 200 })).items).toEqual([]);
  });

  it('takes the trend filter and returns up to the whole answer', async () => {
    const client = createFakeBackend({ phase2: { templates: { count: 200 } } }).client;
    const ask = async (extra: object) => {
      // "Close-up of hands at work" is one of the seeded intents: most of the 200 have it.
      const result = await callRpc(client.templates.search({ text: 'close', ...extra }));
      if (!result.ok) throw new Error(result.error.code);
      return result.value.hits;
    };
    const whole = await ask({ limit: TEMPLATE_SEARCH_MAX_HITS });
    expect(whole.length).toBeGreaterThan(50);
    const stale = await ask({ limit: TEMPLATE_SEARCH_MAX_HITS, stale: true });
    const listed = await client.templates.list({ stale: true, limit: 200 });
    const staleIds = new Set(listed.items.map((item) => item.id));
    expect(stale.length).toBeGreaterThan(0);
    expect(stale.every((hit) => staleIds.has(hit.summary.id))).toBe(true);
    expect(await ask({ limit: 3 })).toEqual(whole.slice(0, 3));
  });

  it('times out every search when failing', async () => {
    const result = await callRpc(backendWith('failing').templates.search({ text: 'sea' }));
    expect(result.ok ? null : result.error.code).toBe('core.timeout');
  });
});

describe('the fake’s words, as the library reads them', () => {
  it('folds case and Latin accents, keeps Devanagari whole, and drops stopwords from a search', () => {
    expect(tokensOf('Café table, first sip')).toEqual(['cafe', 'table', 'first', 'sip']);
    expect(tokensOf('क्या आप जानते हैं?')).toEqual(['क्या', 'आप', 'जानते', 'हैं']);
    expect(queryTerms('A close-up hook with text on screen')).toEqual([
      'close',
      'up',
      'hook',
      'text',
      'screen',
    ]);
    // Nothing but stopwords: they are all kept.
    expect(queryTerms('on the')).toEqual(['on', 'the']);
    expect(listWords('A close-up hook')).toEqual(['a', 'close', 'up', 'hook']);
  });
});

describe('the Templates page’s search scope', () => {
  it('narrows to the view’s folder, favourites, tags, format, language and trend, never its sort or length', () => {
    expect(
      searchScopeOf({
        folder: 'favourites',
        tags: 'travel,food',
        format: 'vlog',
        stale: true,
        sort: 'name',
        length: 'short',
      }),
    ).toEqual({
      favourite: true,
      tags: ['travel', 'food'],
      formatId: 'vlog',
      stale: true,
    });
    expect(searchScopeOf({ folder: 'unfiled', lang: 'hi' })).toEqual({ folderId: 'none', language: 'hi' });
    expect(searchScopeOf({})).toEqual({});
  });
});
