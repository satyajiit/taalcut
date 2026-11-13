// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX4: the page turn. The router asks for one on a change of page, never on the first page, a search change,
// around first run, a view picked from a page's views row, or while the clip's frame or the theme's scene runs.
import { afterEach, describe, expect, it } from 'vitest';
import { pageName } from '../../src/shell/nav/page-arrival';
import { PAGE_TURN, pageTurnTypes, watchViewPresses } from '../../src/shell/nav/page-turn';

const change = (from: string | undefined, to: string, pathChanged = from !== to) => ({
  ...(from === undefined ? {} : { fromLocation: { pathname: from } }),
  toLocation: { pathname: to },
  pathChanged,
});

describe('the page turn', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-clip-moving');
    document.documentElement.removeAttribute('data-theme-transition');
    document.body.innerHTML = '';
  });

  it('turns from one page to another', () => {
    expect(pageTurnTypes(change('/projects', '/library'))).toEqual([PAGE_TURN]);
  });

  it('not on the first page, a search change, or into and out of first run', () => {
    expect(pageTurnTypes(change(undefined, '/projects'))).toBe(false);
    expect(pageTurnTypes(change('/library', '/library', false))).toBe(false);
    expect(pageTurnTypes(change('/onboarding/welcome', '/chat'))).toBe(false);
    expect(pageTurnTypes(change('/projects', '/onboarding'))).toBe(false);
  });

  it('not while the clip’s frame or the theme’s scene runs', () => {
    document.documentElement.setAttribute('data-clip-moving', '');
    expect(pageTurnTypes(change('/library', '/library/clip/1'))).toBe(false);
    document.documentElement.removeAttribute('data-clip-moving');
    document.documentElement.setAttribute('data-theme-transition', 'nightfall');
    expect(pageTurnTypes(change('/projects', '/library'))).toBe(false);
  });

  it('not for a view picked from the page’s views row', () => {
    const stop = watchViewPresses();
    document.body.innerHTML =
      '<nav data-slot="make-views" data-view-links=""><button type="button">Exports</button></nav>';
    document.querySelector('button')!.click();
    expect(pageTurnTypes(change('/projects', '/renders'))).toBe(false);
    stop();
  });

  it('not for a place picked from a rail that swaps the list like a view, or any ViewLinks row', () => {
    const stop = watchViewPresses();
    for (const row of [
      '<nav data-slot="folder-rail" data-view-links=""><a href="/templates/folders/favourites">Favourites</a></nav>',
      '<nav data-slot="anything-else" data-view-links=""><a href="/templates/saved/1">Trips</a></nav>',
    ]) {
      document.body.innerHTML = row;
      document.querySelector('a')!.addEventListener('click', (event) => event.preventDefault());
      document.querySelector('a')!.click();
      expect(pageTurnTypes(change('/templates', '/templates/folders/favourites'))).toBe(false);
    }
    stop();
  });
});

describe('the page’s name', () => {
  afterEach(() => (document.body.innerHTML = ''));

  it('is the bar’s title, crumbs and all, each once', () => {
    document.body.innerHTML =
      '<header data-slot="window-bar"><h1 data-slot="window-title"><a>Library</a><svg></svg><span> Goa sunset </span></h1></header>';
    expect(pageName()).toBe('Library, Goa sunset');
  });
});
