// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createThemeEngine, localStorageStore } from '@taalcut/ui';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { createTestServices } from '../src/services/create';
import { activateLocale } from '../src/i18n/i18n';
import { createAppRouter } from '../src/router';

async function renderAt(path: string, options: Parameters<typeof createFakeBackend>[0] = {}) {
  await activateLocale('en');
  const engine = createThemeEngine({ store: localStorageStore() });
  await engine.init();
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await act(async () => {
    render(
      <App
        engine={engine}
        router={router}
        backend={createFakeBackend(options).client}
        services={createTestServices()}
      />,
    );
    await router.load();
  });
  return router;
}

describe('app shell', () => {
  it('shows the four areas, each with an icon and a word', async () => {
    await renderAt('/library');
    const areas = screen.getByRole('navigation', { name: 'Areas' });
    for (const name of ['Make', 'Library', 'Templates', 'Agent']) {
      const link = screen.getByRole('link', { name });
      expect(areas.contains(link)).toBe(true);
      expect(link.querySelector('svg')).not.toBeNull();
    }
    expect(screen.getByRole('link', { name: 'Library' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeTruthy();
  });

  it('marks Make as current on a project timeline, and the bar leads up to it', async () => {
    await renderAt('/projects/01K7C5M6Q8R9S0T1V2W3X4Y5Z6/timeline');
    const areas = screen.getByRole('navigation', { name: 'Areas' });
    expect(within(areas).getByRole('link', { name: 'Make' }).getAttribute('aria-current')).toBe('page');
    // UX1: the window bar's way up, "Make ›", is a link to the projects (shell/nav).
    const crumb = document.querySelector('[data-slot="window-crumb"]');
    expect(crumb?.textContent).toBe('Make');
    expect(crumb?.getAttribute('href')).toBe('/projects');
  });

  it('redirects / to chat and /settings to General', async () => {
    const home = await renderAt('/');
    // First run is done on the fake: / opens the chat once the progress has loaded.
    await waitFor(() => expect(home.state.location.pathname).toBe('/chat'));
    const settings = await renderAt('/settings');
    expect(settings.state.location.pathname).toBe('/settings/general');
  });

  it('shows the not-found page for a malformed id', async () => {
    await renderAt('/chat/not-an-id');
    expect(await screen.findByRole('heading', { level: 1, name: "This page doesn't exist" })).toBeTruthy();
  });

  it('opens an empty page that teaches its one action', async () => {
    await renderAt('/projects', { make: { empty: true } });
    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Make a video' }).getAttribute('href')).toBe('/chat');
  });

  it('keeps the window bar for Back, Forward and the title (the GitHub links are in Help and About) and the theme switcher in the sidebar', async () => {
    await renderAt('/chat');
    const history = screen.getByRole('group', { name: 'History' });
    expect(within(history).getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(within(history).getByRole('button', { name: 'Forward' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Star on GitHub' })).toBeNull();
    const themeToggle = screen.getByRole('button', { name: /Switch to (dark|light)/ });
    expect(themeToggle.textContent).toMatch(/Switch to (dark|light)/);
  });
});
