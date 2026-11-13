// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-FIND in the window: the Activity filter lives in the URL (`?action=dancing`), becomes the library's
 * `actions` filter, counts as a filter for Clear filters, and its words are translated for the fixed actions and
 * shown as written for a free one. The fake library answers `library.actions` and filters by it as the real one does.
 */
import { setupI18n } from '@lingui/core';
import { actionCountSchema, callRpc, SHOT_ACTIONS } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { toLibraryFilters } from '../src/features/library/filters';
import { hasFilters, NO_FILTERS, parseLibrarySearch } from '../src/features/library/library-search';
import { ACTION_LABELS, actionWords } from '../src/features/library/shot-action-labels';

describe('the Activity filter', () => {
  it('reads an action from the URL, and drops one that no stored action could be', () => {
    expect(parseLibrarySearch({ action: 'dancing' }).action).toBe('dancing');
    expect(parseLibrarySearch({ action: 'kneading dough' }).action).toBe('kneading dough');
    expect(parseLibrarySearch({ action: 'नाचना' }).action).toBe('नाचना');
    for (const bad of ['Dancing', '<b>x</b>', 'x'.repeat(33), '', 7])
      expect(parseLibrarySearch({ action: bad }).action).toBeUndefined();
  });

  it('is the library’s actions filter, counts as a filter, and Clear filters lets it go', () => {
    const search = parseLibrarySearch({ action: 'dancing', q: 'beach' });
    expect(toLibraryFilters(search).actions).toEqual(['dancing']);
    expect(hasFilters(search)).toBe(true);
    const cleared = { ...search, ...NO_FILTERS };
    expect(hasFilters(cleared)).toBe(false);
    expect(cleared.q).toBe('beach');
  });

  it('has words for every fixed action, and keeps a free one as written', () => {
    expect(Object.keys(ACTION_LABELS).sort()).toEqual([...SHOT_ACTIONS].sort());
    const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
    expect(actionWords(i18n, 'playing music')).toEqual({ label: 'Playing music', raw: false });
    expect(actionWords(i18n, 'kneading dough')).toEqual({ label: 'kneading dough', raw: true });
    // Not a key of the object's prototype either.
    expect(actionWords(i18n, 'constructor').raw).toBe(true);
  });
});

describe('the fake library’s actions', () => {
  it('lists the actions the clips show, most first, and filters browse and search by them', async () => {
    const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
    const listed = await callRpc(client.library.actions());
    expect(listed.ok).toBe(true);
    const actions = listed.ok ? listed.value.actions : [];
    expect(actions.length).toBeGreaterThan(5);
    for (const count of actions) expect(actionCountSchema.safeParse(count).success).toBe(true);
    const counts = actions.map((count) => count.assets);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));

    const walking = actions.find((count) => count.action === 'walking')!;
    const page = await callRpc(
      client.library.browse({
        filters: { actions: ['walking'] },
        sort: 'captured',
        direction: 'desc',
        limit: 200,
      }),
    );
    expect(page.ok && page.value.total).toBe(walking.assets);
    const found = await callRpc(
      client.library.search({ query: 'walking', filters: { actions: ['walking'] }, limit: 20 }),
    );
    expect(found.ok && found.value.hits.length).toBeGreaterThan(0);
    const none = await callRpc(client.library.search({ query: 'beach', filters: { actions: ['surfing'] } }));
    expect(none.ok && none.value.hits).toEqual([]);
  });
});
