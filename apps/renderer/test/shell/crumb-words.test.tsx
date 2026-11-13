// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX4: crumbs that carry a thing's own name. An open page names a crumb on its way up (a chat's layout its chat, a
// template's frame its template), the trail takes the name in place of the route's word, and a path no route makes a
// crumb becomes one while it is named. The bar in a browser is e2e/navigation.spec.ts.
import { createMemoryHistory } from '@tanstack/react-router';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REVIEW_APPROVAL, REVIEW_CHAT, TEMPLATE } from '../../e2e/routes';
import { createAppRouter } from '../../src/router';
import { useCrumbWords, useNameCrumb, type CrumbWords } from '../../src/shell/nav/crumb-words';
import { crumbTrail, type CrumbNames } from '../../src/shell/nav/crumbs';
import { renderApp } from '../render-app';

const router = createAppRouter(createMemoryHistory());
const trail = (path: string, names?: CrumbNames) =>
  crumbTrail(router, path, names).map((crumb) => [crumb.words?.text ?? crumb.label?.message, crumb.to]);
const own = (text: string): CrumbWords => ({ text, own: true });

describe('a crumb a page names', () => {
  it('reads the chat’s name on its review page, and Chat until the chat has one', () => {
    expect(trail('/chat/01JC/review/01JA')).toEqual([
      ['Agent', '/chat'],
      ['Chat', '/chat/01JC'],
    ]);
    expect(trail('/chat/01JC/review/01JA', new Map([['/chat/01JC', own('Goa, three days')]]))).toEqual([
      ['Agent', '/chat'],
      ['Goa, three days', '/chat/01JC'],
    ]);
  });

  it('makes a template’s overview a crumb for its other pages once it is named', () => {
    const names = new Map([['/templates/01JT', own('Golden hour market')]]);
    for (const page of ['slots', 'pacing', 'details'])
      expect(trail(`/templates/01JT/${page}`, names), page).toEqual([
        ['Templates', '/templates'],
        ['Golden hour market', '/templates/01JT'],
      ]);
    // Never on the page itself: the overview's name is what is open, not a crumb.
    expect(trail('/templates/01JT', names)).toEqual([['Templates', '/templates']]);
    // Another template's name stays with it.
    expect(trail('/templates/01JX/slots', names)).toEqual([['Templates', '/templates']]);
  });

  it('is named while the page that names it is open, and only by the last one to name it', () => {
    const words = renderHook(() => useCrumbWords());
    const first = renderHook(({ text }) => useNameCrumb('/chat/01JC/', text ? own(text) : null), {
      initialProps: { text: '' },
    });
    // No name yet (still loading): nothing, so the route's word stays.
    expect(words.result.current.has('/chat/01JC')).toBe(false);
    first.rerender({ text: 'Goa, three days' });
    expect(words.result.current.get('/chat/01JC')).toEqual(own('Goa, three days'));
    first.rerender({ text: 'Goa in the rain' });
    expect(words.result.current.get('/chat/01JC')?.text).toBe('Goa in the rain');

    const second = renderHook(() => useNameCrumb('/chat/01JC', own('Another tab')));
    expect(words.result.current.get('/chat/01JC')?.text).toBe('Another tab');
    // The first page leaving doesn't take the second one's name with it.
    act(() => first.unmount());
    expect(words.result.current.get('/chat/01JC')?.text).toBe('Another tab');
    act(() => second.unmount());
    expect(words.result.current.has('/chat/01JC')).toBe(false);
    words.unmount();
  });
});

describe('the bar with a named crumb', () => {
  const bar = () => document.querySelector('[data-slot=window-title]');
  const crumbs = () => [...document.querySelectorAll<HTMLAnchorElement>('[data-slot=window-crumb]')];

  it('reads Templates › the template’s name › Slots, the name a link to its overview, whole in the tooltip', async () => {
    await renderApp(`/templates/${TEMPLATE}/slots`);
    await waitFor(() =>
      expect(crumbs().map((crumb) => crumb.textContent)).toEqual(['Templates', 'Golden hour market']),
    );
    const name = crumbs()[1]!;
    expect(name.getAttribute('href')).toBe(`/templates/${TEMPLATE}`);
    expect(name.title).toBe('Golden hour market');
    expect(name.getAttribute('translate')).toBe('no');
    expect(name.querySelector('[data-user-content]')).not.toBeNull();
    expect(bar()?.querySelector('[data-slot=window-title-open]')?.textContent).toBe('Slots');
  }, 15_000);

  it('reads the template’s name alone on its overview, as what is open', async () => {
    await renderApp(`/templates/${TEMPLATE}`);
    await waitFor(() =>
      expect(bar()?.querySelector('[data-slot=window-title-open]')?.textContent).toBe('Golden hour market'),
    );
    expect(crumbs().map((crumb) => crumb.textContent)).toEqual(['Templates']);
  }, 15_000);

  it('reads Agent › the chat’s name › Review on a chat’s review page', async () => {
    await renderApp(`/chat/${REVIEW_CHAT}/review/${REVIEW_APPROVAL}`);
    await screen.findByText('Review', { selector: '[data-slot=window-title-open]' }, { timeout: 10_000 });
    await waitFor(() =>
      expect(crumbs().map((crumb) => crumb.textContent)).toEqual(['Agent', 'Goa reel, ready to export']),
    );
    expect(crumbs()[1]!.getAttribute('href')).toBe(`/chat/${REVIEW_CHAT}`);
  }, 15_000);
});
