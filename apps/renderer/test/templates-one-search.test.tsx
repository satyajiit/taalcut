// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-FIX: the Templates page runs one search. With words its list is templates.search's answer (the fused words,
// meaning and slot intents, not templates.list's stricter every-word filter), with the page's filters and length
// applied, and the panel under the field lists that answer's first results: the list, its count and the panel can't
// disagree, with filters, with no match and with no Search model. One search runs at a time, the newest words next.
import { I18nProvider } from '@lingui/react';
import type { TemplateSearchQuery } from '@taalcut/core';
import { toSeconds } from '@taalcut/ui';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { createFakeBackend, type FakeBackendOptions } from '../src/backend/fake/fake-backend';
import { lengthOf, type TemplateSearch } from '../src/features/templates/library/template-search';
import { useTemplateLibrary } from '../src/features/templates/library/use-template-library';
import { SEARCH_RESULTS, searchViewOf } from '../src/features/templates/search/search-view';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { watched } from './settings/spied-backend';

beforeAll(() => activateLocale('en'));

/** What the app run typed: no template holds every word, the fused search finds two by their words. */
const STRICT = 'a close-up hook with text on screen';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function page(phase2: FakeBackendOptions['phase2'] = {}, searchMs = 0) {
  const calls = new Map<string, unknown[]>();
  const fake = createFakeBackend({ phase2: { library: { tickMs: 0 }, ...phase2 } });
  const client = watched(
    fake.client,
    [
      {
        namespace: 'templates',
        procedure: 'search',
        answer: async (_input, answer) => {
          await pause(searchMs);
          return answer();
        },
      },
    ],
    calls,
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider i18n={i18n}>
      <BackendProvider backend={client}>{children}</BackendProvider>
    </I18nProvider>
  );
  const hook = renderHook(
    ({ search, words }: { search: TemplateSearch; words: string }) => {
      const library = useTemplateLibrary(search, words);
      return { library, panel: searchViewOf(library, words) };
    },
    { wrapper, initialProps: { search: {}, words: '' } },
  );
  const searches = () => (calls.get('templates.search') ?? []) as TemplateSearchQuery[];
  return { ...hook, client: fake.client, searches };
}

type Page = ReturnType<typeof page>;

/** Types `words` with the view `search` and waits for the page's answer to them. */
async function answer({ result, rerender }: Page, words: string, search: TemplateSearch = {}) {
  rerender({ search, words });
  await waitFor(() => {
    expect(result.current.library.list.data?.words).toBe(words);
    expect(result.current.library.settling).toBe(false);
  });
  const { items = [], matches = null } = result.current.library.list.data ?? {};
  return { items, matches, panel: result.current.panel };
}

const names = (items: readonly { readonly name: string }[]) => items.map((item) => item.name);
const panelIds = (panel: Page['result']['current']['panel']) => panel.hits.map((hit) => hit.summary.id);

describe('the Templates page’s one search', () => {
  it('lists what the fused search finds where the list’s every-word filter finds nothing', async () => {
    const view = page();
    const strict = await view.client.templates.list({ query: STRICT, limit: 200 });
    expect(strict.items).toEqual([]);
    const { items, matches, panel } = await answer(view, STRICT);
    expect(names(items).sort()).toEqual(['Golden hour market', 'Three-hook vlog opener']);
    expect(matches?.hits.every((hit) => hit.matchedBy.includes('words'))).toBe(true);
    // The panel is the answer's first results, in its order: the list's first rows.
    expect(panel.view.kind).toBe('ready');
    expect(panelIds(panel)).toEqual(items.map((item) => item.id));
    expect(view.searches().at(-1)).toMatchObject({ text: STRICT });
  });

  it('applies the page’s filters to the answer, and the panel reads the same filtered answer', async () => {
    const view = page({ templates: { count: 200 } });
    const all = await answer(view, 'market');
    expect(all.items.length).toBeGreaterThan(SEARCH_RESULTS);
    // The panel lists the first eight of the list's rows.
    expect(panelIds(all.panel)).toEqual(all.items.slice(0, SEARCH_RESULTS).map((item) => item.id));

    const favourites = await answer(view, 'market', { folder: 'favourites' });
    expect(favourites.items.length).toBeGreaterThan(0);
    expect(favourites.items.every((item) => item.favourite)).toBe(true);
    expect(view.searches().at(-1)).toMatchObject({ text: 'market', favourite: true });

    const short = await answer(view, 'market', { length: 'short' });
    expect(short.items.length).toBeGreaterThan(0);
    expect(short.items.every((item) => lengthOf(toSeconds(item.duration)) === 'short')).toBe(true);
    expect(panelIds(short.panel)).toEqual(short.items.slice(0, SEARCH_RESULTS).map((item) => item.id));

    const stale = await answer(view, 'market', { stale: true, tags: 'food' });
    expect(view.searches().at(-1)).toMatchObject({ stale: true, tags: ['food'] });
    for (const item of stale.items) expect(item.tags).toContain('food');
    expect(stale.items.every((item) => item.trendFreshness !== null)).toBe(true);
  });

  it('says nothing matches in both the list and the panel', async () => {
    const { items, panel } = await answer(page({ templateSearch: 'ready' }), 'zebra');
    expect(items).toEqual([]);
    expect(panel.view).toMatchObject({ kind: 'ready', result: { hits: [], degraded: null } });
  });

  it('is one answer without the Search model too: both read words only', async () => {
    const { items, matches, panel } = await answer(page(), STRICT);
    expect(matches?.degraded).toBe('keyword-only');
    expect(panel.view).toMatchObject({ kind: 'ready', result: { degraded: 'keyword-only' } });
    expect(panelIds(panel)).toEqual(items.map((item) => item.id));
  });

  it('names the slot a hit found on the list’s row as on the panel’s', async () => {
    const { matches, panel } = await answer(page({ templateSearch: 'ready' }), 'breakfast');
    const morning = matches?.hits.find((hit) => hit.summary.name === 'Slow morning routine');
    expect(morning?.slot).toEqual({ index: 6, intent: 'Café table, first sip' });
    expect(morning && matches?.byId.get(morning.summary.id)).toBe(morning);
    expect(panel.hits.find((hit) => hit.summary.id === morning?.summary.id)?.slot).toEqual(morning?.slot);
  });

  it('lists the library again, by templates.list, once the words go', async () => {
    const view = page();
    await answer(view, 'sea');
    const { items, matches, panel } = await answer(view, '');
    expect(matches).toBeNull();
    expect(items.length).toBe(3);
    expect(panel.view.kind).toBe('empty');
  });

  it('runs one search at a time: later keys wait for it, then the newest words go', async () => {
    const view = page({}, 40);
    await answer(view, '');
    // Six keys while the first key's search is out: it finishes, then the newest words go, once.
    for (const words of ['m', 'ma', 'mar', 'mark', 'marke', 'market']) view.rerender({ search: {}, words });
    const { items } = await answer(view, 'market');
    expect(view.searches().map((query) => query.text)).toEqual(['m', 'market']);
    expect(names(items)).toEqual(['Golden hour market']);
  });
});
