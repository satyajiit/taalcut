// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B9 (the window's part): the update dialog shows the release's notes as text with Restart now and Later;
// nothing opens it by itself except the next launch after a Later.
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BackendProvider, type Backend } from '../../src/backend/backend';
import { closeUpdateDialog } from '../../src/features/updates/update-dialog-state';
import { UpdateReadyItem } from '../../src/features/updates/update-ready-item';
import { i18n } from '../../src/i18n/i18n';
import { renderApp } from '../render-app';

const LATER_KEY = 'taalcut.update.later';

// The dialog's open state lives outside React (one dialog per window): each test starts closed.
afterEach(() => closeUpdateDialog());
/** The item alone, as the shell would mount it. */
const renderItem = (backend: Backend) =>
  render(
    <I18nProvider i18n={i18n}>
      <BackendProvider backend={backend}>
        <UpdateReadyItem />
      </BackendProvider>
    </I18nProvider>,
  );

const ready = (path = '/settings/updates') =>
  renderApp(path, { phase3: { updates: { channel: 'beta', scenario: 'ready', checkMs: 0 } } });

describe('the update dialog', () => {
  it('opens from Settings › Updates with the notes as text, and Restart now asks main to install', async () => {
    const { controls } = await ready();
    const section = within(await screen.findByRole('main'));
    const open = await section.findByRole('button', { name: 'See what’s new' });
    await act(async () => {
      open.focus();
      fireEvent.click(open);
    });
    const dialog = await screen.findByRole('dialog', { name: 'Taalcut 0.3.0-beta.3 is ready' });
    const released = within(dialog).getByText(/Released/);
    expect(released.textContent).toMatch(/^Released .*2026\. It installs when you restart Taalcut\.$/);
    expect(released.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-13T00:00:00.000Z');
    // Bullets are a list, **bold** is <strong>, nothing else is markup.
    const notes = within(dialog).getByRole('region', { name: 'Release notes' });
    expect(within(notes).getAllByRole('listitem')).toHaveLength(3);
    expect(within(notes).getByText('Starter templates').tagName).toBe('STRONG');
    expect(dialog.innerHTML).not.toContain('**');
    // Restart now has focus first: the dialog's one action.
    const restart = within(dialog).getByRole('button', { name: 'Restart now' });
    expect(document.activeElement).toBe(restart);
    await act(async () => {
      fireEvent.click(restart);
    });
    await waitFor(() => expect(controls.phase3.updates.installs).toHaveLength(1));
  });

  it('Later closes it, remembers the version, and focus goes back to the button that opened it', async () => {
    await ready();
    const section = within(await screen.findByRole('main'));
    const open = await section.findByRole('button', { name: 'See what’s new' });
    await act(async () => {
      open.focus();
      fireEvent.click(open);
    });
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Later' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.localStorage.getItem(LATER_KEY)).toBe('0.3.0-beta.3');
    expect(document.activeElement).toBe(open);
  });

  it('Escape counts as Later', async () => {
    await ready();
    const section = within(await screen.findByRole('main'));
    await act(async () => {
      fireEvent.click(await section.findByRole('button', { name: 'See what’s new' }));
    });
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.localStorage.getItem(LATER_KEY)).toBe('0.3.0-beta.3');
  });

  it('a launch after Later opens it once; without a Later it waits to be asked', async () => {
    window.localStorage.setItem(LATER_KEY, '0.3.0-beta.3');
    await ready('/projects');
    await screen.findByRole('dialog', { name: 'Taalcut 0.3.0-beta.3 is ready' });
  });

  it('does not open by itself on a launch without a Later, or for another version', async () => {
    window.localStorage.setItem(LATER_KEY, '0.3.0-beta.1');
    await ready('/projects');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the sidebar’s Update ready item', () => {
  it('shows only while an update is staged, and opens the dialog', async () => {
    const { client } = await ready('/projects');
    const { container } = renderItem(client);
    const item = await within(container).findByRole('button', {
      name: 'Update ready: Taalcut 0.3.0-beta.3. See what’s new.',
    });
    await act(async () => {
      fireEvent.click(item);
    });
    await screen.findByRole('dialog', { name: 'Taalcut 0.3.0-beta.3 is ready' });
  });

  it('is not there without an update', async () => {
    const { client } = await renderApp('/projects', { phase3: { updates: { channel: 'stable' } } });
    const { container } = renderItem(client);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.querySelector('[data-slot=update-ready-item]')).toBeNull();
  });
});
