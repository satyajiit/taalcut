// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nothingFocused, watchLostFocus } from '../src/shell/nav/lost-focus';

type Handler = (event: { pathChanged: boolean }) => void;

/** The two router events the watcher listens to, fired by hand. */
function fakeRouter() {
  const handlers = new Map<string, Handler>();
  return {
    subscribe: ((type: string, handler: Handler) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    }) as never,
    fire: (type: 'onBeforeNavigate' | 'onRendered', pathChanged = true) =>
      handlers.get(type)?.({ pathChanged }),
  };
}

const microtask = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('focus a navigation takes away', () => {
  let stop: () => void = () => undefined;
  let router: ReturnType<typeof fakeRouter>;

  beforeEach(() => {
    document.body.innerHTML = `
      <nav><a id="make" href="/projects">Make</a></nav>
      <main id="main"><ul><li><a id="row" href="/projects/p1">Golden hour market</a></li></ul></main>`;
    router = fakeRouter();
    stop = watchLostFocus(router);
  });
  afterEach(() => stop());

  it('goes to the page’s main area when the row that had it goes with the list', async () => {
    document.getElementById('row')?.focus();
    router.fire('onBeforeNavigate');
    document.querySelector('ul')?.remove();
    await microtask();
    expect(document.activeElement).toBe(document.querySelector('main'));
    expect(document.querySelector('main')?.getAttribute('tabindex')).toBe('-1');
    expect(nothingFocused()).toBe(true);
  });

  it('goes to the main area when the row is hidden before it goes (the bones showing)', async () => {
    document.getElementById('row')?.focus();
    router.fire('onBeforeNavigate');
    document.getElementById('row')?.blur();
    await microtask();
    expect(document.activeElement).toBe(document.querySelector('main'));
  });

  it('is put right by the time the page has rendered, even before the removal is reported', () => {
    document.getElementById('row')?.focus();
    router.fire('onBeforeNavigate');
    document.querySelector('ul')?.remove();
    router.fire('onRendered');
    expect(document.activeElement).toBe(document.querySelector('main'));
  });

  it('leaves a sidebar link that stays where it is', async () => {
    document.getElementById('make')?.focus();
    router.fire('onBeforeNavigate');
    document.querySelector('ul')?.remove();
    await microtask();
    expect(document.activeElement).toBe(document.getElementById('make'));
  });

  it('keeps watching after the page reports itself rendered, until the old list goes', async () => {
    document.getElementById('row')?.focus();
    router.fire('onBeforeNavigate');
    router.fire('onRendered');
    document.querySelector('ul')?.remove();
    await microtask();
    expect(document.activeElement).toBe(document.querySelector('main'));
  });

  it('leaves alone what the person focused or clicked meanwhile', async () => {
    document.getElementById('row')?.focus();
    router.fire('onBeforeNavigate');
    document.getElementById('make')?.focus();
    document.querySelector('ul')?.remove();
    await microtask();
    expect(document.activeElement).toBe(document.getElementById('make'));

    document.body.insertAdjacentHTML('beforeend', '<main><a id="again" href="/x">x</a></main>');
    document.getElementById('again')?.focus();
    router.fire('onBeforeNavigate');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    (document.activeElement as HTMLElement | null)?.blur();
    document.getElementById('again')?.remove();
    await microtask();
    expect(document.activeElement).toBe(document.body);
  });

  it('does nothing for a search or filter change on the same page, and keeps the watch', async () => {
    document.getElementById('row')?.focus();
    router.fire('onBeforeNavigate', false);
    document.querySelector('ul')?.remove();
    await microtask();
    expect(document.activeElement).toBe(document.body);

    document.querySelector('main')?.insertAdjacentHTML('beforeend', '<a id="next" href="/x">x</a>');
    document.getElementById('next')?.focus();
    router.fire('onBeforeNavigate');
    router.fire('onBeforeNavigate', false);
    document.getElementById('next')?.remove();
    await microtask();
    expect(document.activeElement).toBe(document.querySelector('main'));
  });
});
