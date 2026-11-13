// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Back, Forward and the way up (UX1 nav, DESIGN.md "Window" v0.4): the ledger that knows whether each step leads
// anywhere, never into first run from the app; Settings' way out; the crumbs every nested route gets from its
// parents' staticData; ⌘[ ⌘] and the mouse's side buttons. The whole journey in a browser is e2e/navigation.spec.ts.
import { createMemoryHistory, type RouterHistory } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppRouter } from '../src/router';
import { isUnder } from '../src/shell/areas';
import { crumbTrail, ownCrumb, parentPath } from '../src/shell/nav/crumbs';
import { createHistoryLedger, LEDGER_STORAGE_KEY } from '../src/shell/nav/history-ledger';
import { watchHistoryKeys } from '../src/shell/nav/history-keys';
import { pageAnswersMouseButtons, watchMouseHistory } from '../src/shell/nav/pointer-history';

/** sessionStorage as the ledger uses it, in memory. */
function memoryStore() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const at = (history: RouterHistory) => history.location.pathname;

describe('the history ledger', () => {
  it('knows when Back and Forward lead somewhere: a new page cuts off what was ahead', () => {
    const history = createMemoryHistory({ initialEntries: ['/chat'] });
    const ledger = createHistoryLedger(history, memoryStore());
    expect(ledger.get()).toMatchObject({ canGoBack: false, canGoForward: false, move: 'start' });
    history.push('/library');
    history.push('/library/01J');
    expect(ledger.get()).toMatchObject({
      canGoBack: true,
      canGoForward: false,
      move: 'push',
      previous: '/library',
    });
    ledger.back();
    expect(at(history)).toBe('/library');
    expect(ledger.get()).toMatchObject({
      canGoBack: true,
      canGoForward: true,
      move: 'pop',
      previous: '/chat',
    });
    ledger.forward();
    expect(at(history)).toBe('/library/01J');
    ledger.back();
    history.push('/templates');
    expect(ledger.get()).toMatchObject({ canGoForward: false, previous: '/library' });
    ledger.forward();
    expect(at(history)).toBe('/templates');
  });

  it('knows the page one step back with its search, so a crumb to another view of it opens that view', () => {
    const history = createMemoryHistory({ initialEntries: ['/projects?archived=true'] });
    const ledger = createHistoryLedger(history, memoryStore());
    history.push('/projects/01JP/timeline');
    expect(ledger.get().previous).toBe('/projects?archived=true');
  });

  it('tells its listeners, and a replace is not a new page', () => {
    const history = createMemoryHistory({ initialEntries: ['/library'] });
    const ledger = createHistoryLedger(history, memoryStore());
    const heard = vi.fn();
    const stop = ledger.subscribe(heard);
    history.push('/templates');
    history.replace('/templates?q=cafe');
    expect(heard).toHaveBeenCalledTimes(2);
    expect(ledger.get()).toMatchObject({ move: 'replace', canGoBack: true, previous: '/library' });
    stop();
    history.push('/chat');
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('never steps from the app back into first run', () => {
    const history = createMemoryHistory({ initialEntries: ['/onboarding/welcome'] });
    const ledger = createHistoryLedger(history, memoryStore());
    history.push('/onboarding/ready');
    expect(ledger.get().canGoBack).toBe(true);
    history.push('/chat');
    expect(ledger.get().canGoBack).toBe(false);
    ledger.back();
    expect(at(history)).toBe('/chat');
  });

  it('carries on after a reload of the same history, and starts clean for another', () => {
    const store = memoryStore();
    const history = createMemoryHistory({ initialEntries: ['/chat'] });
    createHistoryLedger(history, store);
    history.push('/library');
    history.push('/templates');
    history.back();
    expect(store.items.has(LEDGER_STORAGE_KEY)).toBe(true);
    // The page loads again on the same entry: what was ahead is still ahead.
    expect(createHistoryLedger(history, store).get()).toMatchObject({ canGoBack: true, canGoForward: true });
    // Another window's history, or a test's, at an index the store has: its key doesn't match.
    const other = createMemoryHistory({ initialEntries: ['/chat'] });
    other.push('/library');
    expect(createHistoryLedger(other, store).get()).toMatchObject({ canGoForward: false, previous: null });
  });

  it('starts clean from a store it cannot read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = memoryStore();
    store.setItem(LEDGER_STORAGE_KEY, '{not json');
    const ledger = createHistoryLedger(createMemoryHistory({ initialEntries: ['/chat'] }), store);
    expect(ledger.get()).toMatchObject({ canGoBack: false, canGoForward: false });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('leaves Settings for the page it was opened from, however many sections you looked at', () => {
    const inSettings = (path: string) => isUnder(path, ['/settings']);
    const history = createMemoryHistory({ initialEntries: ['/library'] });
    const ledger = createHistoryLedger(history, memoryStore());
    history.push('/library/01J');
    history.push('/settings/models');
    history.push('/settings/about');
    history.push('/settings/brand');
    expect(ledger.leave(inSettings)).toBe(true);
    expect(at(history)).toBe('/library/01J');
    // Opened first, there is no page to go back to: the link goes where it points.
    const first = createMemoryHistory({ initialEntries: ['/settings/models'] });
    expect(createHistoryLedger(first, memoryStore()).leave(inSettings)).toBe(false);
    expect(at(first)).toBe('/settings/models');
  });
});

describe('the way up', () => {
  const router = createAppRouter(createMemoryHistory());
  const trail = (path: string) => crumbTrail(router, path).map((crumb) => [crumb.label?.message, crumb.to]);

  it("is every page above by path that is a crumb, from the routes' staticData", () => {
    expect(trail('/library/01JABCDEF')).toEqual([['Library', '/library']]);
    expect(trail('/library/phone')).toEqual([['Library', '/library']]);
    expect(trail('/library/import/phone-wifi')).toEqual([
      ['Library', '/library'],
      ['Import', '/library/import'],
    ]);
    expect(trail('/library/imports/01JABCDEF')).toEqual([
      ['Library', '/library'],
      ['Imports', '/library/imports'],
    ]);
    expect(trail('/templates/01JT')).toEqual([['Templates', '/templates']]);
    // A template's sub-pages (UX4 tpl) go up past its overview, which is no crumb, to Templates.
    expect(trail('/templates/01JT/slots')).toEqual([['Templates', '/templates']]);
    // The hub is Start from… › Community (UX4 tpl).
    expect(trail('/templates/start/community')).toEqual([
      ['Templates', '/templates'],
      ['Start from…', '/templates/start'],
    ]);
    expect(trail('/templates/start/community/01JH')).toEqual([
      ['Templates', '/templates'],
      ['Start from…', '/templates/start'],
      ['Community', '/templates/start/community'],
    ]);
    // Saved's crumb is short: a crumb is never cut, and the views row names it in full.
    expect(trail('/templates/saved/col_1')).toEqual([
      ['Templates', '/templates'],
      ['Saved', '/templates/saved'],
    ]);
    // The editor skips /projects/$id (not a page) and goes up to the Make area's page.
    expect(trail('/projects/01JP/timeline')).toEqual([['Make', '/projects']]);
    expect(trail('/settings/brand/01JS')).toEqual([['Brand kits', '/settings/brand']]);
    expect(trail('/chat/01JC')).toEqual([['Agent', '/chat']]);
  });

  it("follows a route's own `up` where the page above isn't its path's parent", () => {
    expect(trail('/renders')).toEqual([['Make', '/projects']]);
    // UX4 set: Updates, This Mac and About are General's views; General is the page above them.
    for (const path of ['/settings/updates', '/settings/this-mac', '/settings/about'])
      expect(trail(path), path).toEqual([['General', '/settings/general']]);
  });

  it('is empty on the areas themselves and on pages with nothing above', () => {
    for (const path of ['/library', '/templates', '/projects', '/chat', '/settings/general', '/nowhere/deep'])
      expect(trail(path), path).toEqual([]);
  });

  it("makes a filtered view's own name a link to the page itself, where its route is a crumb", () => {
    expect(ownCrumb(router, '/projects')).toMatchObject({ to: '/projects', label: { message: 'Make' } });
    expect(ownCrumb(router, '/templates/01JT')).toBeNull();
    expect(ownCrumb(router, '/settings/about')).toBeNull();
  });

  it('steps up one segment at a time', () => {
    expect(parentPath('/templates/hub/01J')).toBe('/templates/hub');
    expect(parentPath('/library/')).toBe('/');
    expect(parentPath('/')).toBeNull();
  });
});

describe('⌘[ and ⌘]', () => {
  const ledger = { back: vi.fn(), forward: vi.fn() };
  const stop = watchHistoryKeys(ledger);
  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
    window.dispatchEvent(event);
    return event;
  };

  afterEach(() => {
    ledger.back.mockClear();
    ledger.forward.mockClear();
    document.body.replaceChildren();
  });

  it('steps back and forward, by the key or by its place, and keeps the press from the menu', () => {
    expect(press({ key: '[', metaKey: true }).defaultPrevented).toBe(true);
    press({ key: ']', metaKey: true });
    press({ key: 'ü', code: 'BracketLeft', ctrlKey: true });
    expect(ledger.back).toHaveBeenCalledTimes(2);
    expect(ledger.forward).toHaveBeenCalledOnce();
  });

  it('leaves other chords, a held key and an open dialog alone', () => {
    expect(press({ key: '[', metaKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    press({ key: '[' });
    press({ key: '[', metaKey: true, repeat: true });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.dataset.state = 'open';
    document.body.append(dialog);
    // Kept from the menu as well, so the page never changes behind the dialog.
    expect(press({ key: '[', metaKey: true }).defaultPrevented).toBe(true);
    expect(ledger.back).not.toHaveBeenCalled();
    dialog.dataset.state = 'closed';
    press({ key: '[', metaKey: true });
    expect(ledger.back).toHaveBeenCalledOnce();
  });

  it('steps while a closed native popover waits in the page', () => {
    // The window bar's downloads popover is a dialog that stays in the page, hidden, until it opens.
    const popover = document.createElement('div');
    popover.setAttribute('popover', 'auto');
    popover.setAttribute('role', 'dialog');
    document.body.append(popover);
    press({ key: '[', metaKey: true });
    expect(ledger.back).toHaveBeenCalledOnce();
  });

  it('comes before a control with its own [ and ], which keeps the bare keys', () => {
    const clip = document.createElement('div');
    const trims = vi.fn((event: KeyboardEvent) => event.stopPropagation());
    clip.addEventListener('keydown', trims);
    document.body.append(clip);
    const pressOn = (init: KeyboardEventInit) =>
      clip.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init }));
    pressOn({ key: '[', metaKey: true });
    expect(ledger.back).toHaveBeenCalledOnce();
    expect(trims).not.toHaveBeenCalled();
    pressOn({ key: '[' });
    expect(trims).toHaveBeenCalledOnce();
    expect(ledger.back).toHaveBeenCalledOnce();
    stop();
  });
});

describe("the mouse's side buttons", () => {
  it('step back and forward on release', () => {
    const ledger = { back: vi.fn(), forward: vi.fn() };
    const stop = watchMouseHistory(ledger);
    const press = (button: number) => {
      const down = new MouseEvent('mousedown', { button, cancelable: true });
      window.dispatchEvent(down);
      window.dispatchEvent(new MouseEvent('mouseup', { button, cancelable: true }));
      return down;
    };
    expect(press(3).defaultPrevented).toBe(true);
    press(4);
    expect(press(0).defaultPrevented).toBe(false);
    expect(ledger.back).toHaveBeenCalledOnce();
    expect(ledger.forward).toHaveBeenCalledOnce();
    stop();
  });

  it("are the page's on a Mac and in a browser; elsewhere main answers them", () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    expect(pageAnswersMouseButtons(true, mac)).toBe(true);
    expect(pageAnswersMouseButtons(true, windows)).toBe(false);
    expect(pageAnswersMouseButtons(false, windows)).toBe(true);
  });
});
