// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// The window bar holds the title and actions of what is on screen. While the next page's code loads, React keeps the
// leaving page mounted and hidden behind the router's pending view (a Suspense fallback), and hiding doesn't reach
// what the page portals into the bar: its title stayed beside the bones' own, two `window-title`s at once
// (projects.spec, UX2 round 2). Here a Suspense boundary already showing a page gets a page that suspends, as the
// router's does.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Suspense, use, useState, type ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { activateLocale } from '../src/i18n/i18n';
import { ToolbarActions, ToolbarSlotsProvider, ToolbarTitle } from '../src/shell/toolbar';

beforeAll(async () => {
  await activateLocale('en');
});

/** A page with its name and one action in the bar. */
function Page({ name }: { name: string }) {
  return (
    <>
      <ToolbarTitle title={name} />
      <ToolbarActions>
        <button type="button">{`${name} action`}</button>
      </ToolbarActions>
      <p>{`${name} page`}</p>
    </>
  );
}

/** A page whose code is on its way: it suspends until `code` resolves. */
function Arriving({ code, name }: { code: Promise<void>; name: string }) {
  use(code);
  return <Page name={name} />;
}

/** The bones the router shows meanwhile: the next page's name as a plain line, no actions. */
function Bones({ name }: { name: string }) {
  return <ToolbarTitle as="p" title={name} />;
}

let show: (page: ReactNode) => void = () => undefined;

/** The bar's two slots, and under them one Suspense boundary for the pages, as the root and a route have. */
function Shell() {
  const [title, setTitle] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [page, setPage] = useState<ReactNode>(<Page name="Make" />);
  show = setPage;
  return (
    <ToolbarSlotsProvider value={{ title, actions }}>
      <header>
        <div ref={setTitle} data-testid="title-slot" />
        <div ref={setActions} data-testid="actions-slot" />
      </header>
      <Suspense fallback={<Bones name="Exports" />}>{page}</Suspense>
    </ToolbarSlotsProvider>
  );
}

async function renderShell() {
  const root = createRootRoute({ component: Shell });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  await act(async () => {
    render(
      <I18nProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nProvider>,
    );
    await router.load();
  });
}

const titles = () =>
  [...screen.getByTestId('title-slot').querySelectorAll('[data-slot=window-title]')].map(
    (title) => `${title.tagName.toLowerCase()} ${title.textContent ?? ''}`,
  );
const actions = () =>
  [...screen.getByTestId('actions-slot').querySelectorAll('button')].map((button) => button.textContent);

describe('the window bar while the next page loads', () => {
  it("holds the bones' title alone, then the next page's title and actions", async () => {
    await renderShell();
    expect(titles()).toEqual(['h1 Make']);
    expect(actions()).toEqual(['Make action']);

    let arrive: () => void = () => undefined;
    const code = new Promise<void>((resolve) => (arrive = resolve));
    await act(async () => show(<Arriving code={code} name="Exports" />));
    // The leaving page is still mounted, hidden; nothing of it is in the bar.
    expect(screen.getByText('Make page', { selector: 'p' }).style.display).toBe('none');
    expect(titles()).toEqual(['p Exports']);
    expect(actions()).toEqual([]);

    await act(async () => {
      arrive();
      await code;
    });
    // React keeps a fallback up for a moment once it shows (its throttle), then the page takes its place.
    await waitFor(() => expect(titles()).toEqual(['h1 Exports']));
    expect(actions()).toEqual(['Exports action']);
    expect(screen.queryByText('Make page')).toBeNull();
  });

  it('gives the bar back to the page when it shows again', async () => {
    await renderShell();
    const code = new Promise<void>(() => undefined);
    await act(async () => show(<Arriving code={code} name="Exports" />));
    expect(titles()).toEqual(['p Exports']);
    // The navigation is undone before the next page's code arrives: the same page, shown again.
    await act(async () => show(<Page name="Make" />));
    await waitFor(() => expect(titles()).toEqual(['h1 Make']));
    expect(actions()).toEqual(['Make action']);
  });
});
