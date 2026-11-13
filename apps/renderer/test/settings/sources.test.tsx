// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1 W2-2: Settings › Sources on the library contract. The folders with their state in words and the phone as one
// row that opens Library › From your phone (UX4: the phone's transfers live there, not here), Add folder through the
// folder dialog, Remove with Undo, the empty list's shape, a read that fails, and a folder's own
// menu: watch (which the fake library doesn't have, so the test registers it on its bus) and look again (the fake's).
import {
  defineCommand,
  err,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  ok,
  TimeoutError,
  toRpcError,
  type SourceId,
} from '@taalcut/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../render-app';
import { renderWatched } from './spied-backend';

/** A small library that doesn't index on its own. */
const LIBRARY = { count: 40, tickMs: 0 };

const folderList = () => screen.findByRole('list', { name: 'Folders' });
const names = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('[data-user-content]')?.textContent);
const row = (list: HTMLElement, name: string) => {
  const found = within(list)
    .getAllByRole('listitem')
    .find((item) => item.querySelector('[data-user-content]')?.textContent === name);
  if (!found) throw new Error(`no row for ${name}`);
  return found;
};

describe('Settings › Sources (UX1 W2-2)', () => {
  it('lists the folders and the phone, each with its state in words', async () => {
    await renderApp('/settings/sources', { phase2: { library: LIBRARY } });
    const folders = await folderList();
    expect(names(folders)).toEqual(['Goa trip', 'Samsung T7', 'Desktop clips']);
    // A drive that isn't plugged in says so, and offers to look again.
    const drive = row(folders, 'Samsung T7');
    expect(drive.textContent).toContain('The drive isn’t connected.');
    expect(within(drive).getByRole('button', { name: 'Check again Samsung T7' })).toBeTruthy();
    // A folder that is fine has no Check again: Remove and its menu.
    const goa = row(folders, 'Goa trip');
    expect(within(goa).queryByRole('button', { name: 'Check again Goa trip' })).toBeNull();
    expect(within(goa).getByRole('button', { name: 'Remove Goa trip' })).toBeTruthy();
    expect(within(goa).getByRole('button', { name: 'More for Goa trip' })).toBeTruthy();
    expect(goa.textContent).toContain('/Users/me/Movies/Goa trip');
    // When it was last looked through is Intl's words in a <time>: data, so the pseudo-locale leaves it be.
    const checked = goa.querySelector('[data-slot=source-status] time');
    expect(checked?.getAttribute('dateTime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(checked?.parentElement?.textContent).toMatch(/Checked /);
    // The phone is one row that says how much came from it and opens Library › From your phone.
    const phone = document.querySelector('[data-slot=sources-phone]');
    expect(phone?.textContent).toMatch(/clips? from your phone/);
    expect(phone?.querySelector('a')?.getAttribute('href')).toBe('/library/imports?phones=true');
    expect(screen.queryByRole('list', { name: 'Phones' })).toBeNull();
    // No Loading spinner anywhere on the page.
    expect(document.querySelector('[data-slot=loading]')).toBeNull();
  });

  it('Add folder opens the shared connection without starting a picker or import', async () => {
    const { router, controls } = await renderApp('/settings/sources', { phase2: { library: LIBRARY } });
    await folderList();
    fireEvent.click(screen.getByRole('link', { name: 'Add folder…' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/library/import/folder'));
    expect(controls.dispatched.some((d) => d.name.startsWith('imports.'))).toBe(false);
  });

  it('Remove takes a folder out with an Undo, and Undo puts it back', async () => {
    await renderApp('/settings/sources', { phase2: { library: LIBRARY } });
    const folders = await folderList();
    fireEvent.click(
      within(row(folders, 'Desktop clips')).getByRole('button', { name: 'Remove Desktop clips' }),
    );
    await waitFor(async () => expect(names(await folderList())).toEqual(['Goa trip', 'Samsung T7']));
    expect(await screen.findByText('Removed Desktop clips')).toBeTruthy();
    expect(screen.getByText('Its clips left your library. The files stay where they are.')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(names(await folderList())).toContain('Desktop clips'));
  });

  it('empty: Kaatu, one line and the shape of the list, still', async () => {
    await renderApp('/settings/sources', { phase2: { library: { count: 0, tickMs: 0 } } });
    expect(await screen.findByRole('heading', { name: 'No folders yet' })).toBeTruthy();
    // Empty, the one Add folder is the empty state's own: the section's heading has none of its own.
    expect(screen.getAllByRole('link', { name: 'Add folder…' })).toHaveLength(1);
    const ghosts = document.querySelector('[data-slot=sources-empty] [aria-hidden=true]');
    expect(ghosts?.querySelectorAll('li')).toHaveLength(3);
    // Still: the ghost rows don't pulse, since nothing is loading.
    expect(ghosts?.querySelector('.tc-bone')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Folders' })).toBeNull();
    expect(screen.getByText('Nothing sent from a phone yet.')).toBeTruthy();
  });

  it('a read that fails says what didn’t load and why, and Try again reads again', async () => {
    let fail = true;
    const { callsTo } = await renderWatched('/settings/sources', {
      namespace: 'library',
      procedure: 'sources',
      answer: (_input, fake) => (fail ? Promise.reject(toRpcError(TimeoutError({ ms: 5_000 }))) : fake()),
    });
    expect(await screen.findByText('Your sources didn’t load.')).toBeTruthy();
    expect(screen.getByText('This took too long and was stopped. Try again.')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await folderList();
    expect(callsTo({ namespace: 'library', procedure: 'sources' }).length).toBeGreaterThan(1);
  });

  it('a folder’s menu turns watching off and looks through it again; a refusal shows on its row', async () => {
    const { controls } = await renderApp('/settings/sources', { phase2: { library: LIBRARY } });
    const seen: { name: string; payload: unknown }[] = [];
    let refuse = false;
    controls.bus.register(
      defineCommand({
        name: LIBRARY_COMMANDS.setSourceWatch,
        payload: libraryCommandPayloads[LIBRARY_COMMANDS.setSourceWatch],
        sideEffect: 'write',
        project: () => null,
        handle: async (payload) => {
          seen.push({ name: LIBRARY_COMMANDS.setSourceWatch, payload });
          return refuse ? err(TimeoutError({ ms: 5_000 })) : ok({ result: null });
        },
      }),
    );
    const openMenu = async () =>
      fireEvent.keyDown(
        within(row(await folderList(), 'Goa trip')).getByRole('button', { name: 'More for Goa trip' }),
        { key: 'Enter' },
      );
    const sourceId = row(await folderList(), 'Goa trip').getAttribute('data-source') as SourceId;
    await openMenu();
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Watch for new clips' }));
    await waitFor(() =>
      expect(seen).toEqual([{ name: LIBRARY_COMMANDS.setSourceWatch, payload: { sourceId, watch: false } }]),
    );
    // Look through it again: the row says it's looking until the fake's scan ends.
    await openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Look through it again' }));
    expect(await within(row(await folderList(), 'Goa trip')).findByText('Looking for clips…')).toBeTruthy();
    // A refusal shows on its row, with its cause.
    refuse = true;
    await openMenu();
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Watch for new clips' }));
    const refused = await within(row(await folderList(), 'Goa trip')).findByRole('alert');
    expect(refused.textContent).not.toMatch(/Something went wrong/);
  });
});
