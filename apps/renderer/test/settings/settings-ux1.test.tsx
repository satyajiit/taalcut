// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1 W2-2: what the Settings redesign promises, page by page. Memory says what is true (LRN1-MEM's page); with
// Privacy's Local only on, Models says what it does to the profile in use; External agents shows the Connect form
// only once the switch is on; About names a build from source; the update-ready row restarts; and no page shows
// the old Loading spinner or a "Something went wrong".
import { MODEL_COMMANDS } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../render-app';

const SETTINGS_PAGES = [
  '/settings/general',
  '/settings/updates',
  '/settings/this-mac',
  '/settings/about',
  '/settings/sources',
  '/settings/memory',
  '/settings/models',
  '/settings/models/downloads',
  '/settings/accounts',
  '/settings/accounts/keys',
  '/settings/accounts/subscriptions',
  '/settings/accounts/servers',
  '/settings/external-agents',
  '/settings/privacy',
  '/settings/privacy/sharing',
  '/settings/usage',
  '/settings/usage/breakdown',
  '/settings/usage/budgets',
  '/settings/usage/requests',
  '/settings/brand',
] as const;

describe('Settings › Memory', () => {
  it('lists what Taalcut remembers by where it applies, and says where it goes', async () => {
    await renderApp('/settings/memory');
    const section = await screen.findByRole('region', { name: 'What Taalcut remembers' });
    await within(section).findByRole('heading', { name: 'Every video' });
    expect(document.body.textContent).not.toContain('remember preferences between chats yet');
    const cloud = screen.getByRole('region', { name: 'Cloud models' });
    expect(within(cloud).getByRole('switch', { name: 'Use memory with cloud models' })).toBeTruthy();
  });

  it('empty, one honest line and Start a chat; no tiles or chips', async () => {
    await renderApp('/settings/memory', { phase3: { memory: { scenario: 'empty' } } });
    const section = await screen.findByRole('region', { name: 'What Taalcut remembers' });
    // UX4 set: the kit's EmptyState, its title a heading and its line under it.
    await within(section).findByRole('heading', { name: 'Nothing remembered yet' });
    expect(within(section).getByText(/^Add something above, or tell the agent in a chat/)).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'Start a chat' }).getAttribute('href')).toBe('/chat');
    expect(section.querySelectorAll('[data-slot=chip], img, svg:not([aria-hidden])')).toHaveLength(0);
  });
});

describe('Settings › Models and Privacy’s Local only', () => {
  const note = () => document.querySelector<HTMLElement>('[data-slot=profile-note]');

  it('with Local only on, a line over the profiles says what it does to this one, and On this Mac can be chosen', async () => {
    const { controls } = await renderApp('/settings/models', { phase2b: { privacy: { localOnly: true } } });
    const profiles = await screen.findByRole('radiogroup', { name: 'Profile' });
    await waitFor(() =>
      expect(note()?.textContent).toMatch(
        /^Local only is on in Privacy, so the jobs this profile sends to the cloud are off\./,
      ),
    );
    expect(
      within(note() as HTMLElement)
        .getByRole('link', { name: 'Privacy' })
        .getAttribute('href'),
    ).toBe('/settings/privacy');
    const onThisMac = within(profiles).getByRole('radio', { name: 'On this Mac' }) as HTMLInputElement;
    expect(onThisMac.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(onThisMac);
    });
    await waitFor(() =>
      expect(note()?.textContent).toBe(
        'Local only is on in Privacy, and On this Mac runs each job on this Mac.',
      ),
    );
    // The line follows the saved profile (the settings stream), not just the click.
    expect(controls.dispatched.filter((d) => d.name === MODEL_COMMANDS.setProfile)).toEqual([
      { name: MODEL_COMMANDS.setProfile, source: 'ui' },
    ]);
  });

  it('with Local only off, no line over the profiles', async () => {
    await renderApp('/settings/models');
    const profiles = await screen.findByRole('radiogroup', { name: 'Profile' });
    expect(within(profiles).getByRole('radio', { name: 'On this Mac' })).toBeTruthy();
    expect(note()).toBeNull();
  });

  it('Privacy’s switch is Local only, and its line names the On this Mac profile', async () => {
    await renderApp('/settings/privacy', { phase2b: { privacy: { localOnly: true } } });
    expect(await screen.findByRole('switch', { name: 'Local only' })).toBeTruthy();
    // The notice is one of the page's live regions: while the standing consents load, their skeleton's "Loading"
    // is another. Find the one that says it, and wait for it rather than read the page at one moment.
    const localOnlyLine = /The On this Mac profile in Models runs the most jobs here\./;
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').filter((status) => localOnlyLine.test(status.textContent ?? '')),
      ).toHaveLength(1),
    );
  });
});

describe('Settings › External agents', () => {
  it('off: no Connect form; on: the form appears', async () => {
    const { controls } = await renderApp('/settings/external-agents', {
      phase3: { mcp: { scenario: 'off' } },
    });
    const agents = await screen.findByRole('switch', { name: /Let agents on this Mac use Taalcut/ });
    expect(screen.queryByRole('region', { name: 'Connect an agent' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Connected agents' })).toBeNull();
    await act(async () => {
      fireEvent.click(agents);
    });
    await waitFor(() => expect(controls.phase3.mcp.watch.get().enabled).toBe(true));
    expect(await screen.findByRole('region', { name: 'Connect an agent' })).toBeTruthy();
  });

  it('a server that won’t start names the cause, not “Something went wrong”', async () => {
    await renderApp('/settings/external-agents', { phase3: { mcp: { scenario: 'error' } } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/Something went wrong/);
    expect(alert.textContent?.length ?? 0).toBeGreaterThan(20);
  });
});

describe('Settings › About and updates', () => {
  it('a build from source is a Development build, and This Mac is a list of facts', async () => {
    const { router } = await renderApp('/settings/about');
    await waitFor(() =>
      expect(document.querySelector('[data-slot=about-version]')?.textContent).toBe('Development build'),
    );
    // UX4 set: This Mac's facts are General's This Mac view, from their own query.
    await act(async () => {
      await router.navigate({ to: '/settings/this-mac' });
    });
    await waitFor(() =>
      expect(document.querySelectorAll('dl[aria-label="This Mac"] dt').length).toBeGreaterThan(1),
    );
  });

  it('an update ready to install has Restart now on its row', async () => {
    const { controls } = await renderApp('/settings/updates', {
      phase3: { updates: { channel: 'beta', scenario: 'ready', checkMs: 0 } },
    });
    const status = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-slot=update-status][data-status=ready]');
      if (!found) throw new Error('no ready row yet');
      return found;
    });
    expect(status.textContent).toContain('It installs when you restart Taalcut, or now with Restart now.');
    await act(async () => {
      fireEvent.click(within(status).getByRole('button', { name: 'Restart now' }));
    });
    await waitFor(() => expect(controls.phase3.updates.installs).toHaveLength(1));
  });
});

describe('Settings, every page', () => {
  it.each(SETTINGS_PAGES)('%s: no Loading spinner and no “Something went wrong”', async (path) => {
    await renderApp(path);
    await waitFor(() => expect(document.querySelector('[data-boneyard][aria-busy=true]')).toBeNull(), {
      timeout: 3_000,
    });
    expect(document.querySelector('[data-slot=loading]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Something went wrong/);
  });
});
