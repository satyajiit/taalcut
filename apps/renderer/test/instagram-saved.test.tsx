// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from './render-app';

describe('Saved on Instagram (/templates/saved)', () => {
  it('signs in behind WarningCard, browses Saved collections, toggles watch settings, and sends a Reel to chat', async () => {
    const { client, controls, router } = await renderApp('/templates/saved');

    // Signed out: shows Sign in to Instagram button and opens WarningCard on click.
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to Instagram' }));
    const card = await screen.findByRole('region', {
      name: 'Using your Instagram Saved collections in Taalcut',
    });
    expect(within(card).getByRole('button', { name: 'Paste a Reel link instead' })).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: 'I understand' }));

    // Signed in: shows Saved collections rail (each collection a page: UX4 tpl) and Saved reels list.
    const nav = await screen.findByRole('navigation', { name: 'Saved collections' });
    expect(within(nav).getByRole('link', { name: /Reels Inspo/ })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: /Strong Hooks/ })).toBeTruthy();

    // Switch to the Reels Inspo collection.
    fireEvent.click(within(nav).getByRole('link', { name: /Reels Inspo/ }));
    expect(await screen.findByText('Golden hour street cuts synced to the snare')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/templates/saved/col_inspo');

    // Saved's settings: watch Reels Inspo and enable Read new reels automatically.
    // Saved's own Settings link, by the account at the views' end (the sidebar has a Settings link too).
    const settings = await waitFor(() => {
      const account = document.querySelector<HTMLElement>('[data-slot=saved-account]');
      if (!account) throw new Error('No account on the collection’s page yet');
      return within(account).getByRole('link', { name: 'Settings' });
    });
    fireEvent.click(settings);
    const row = (
      await screen.findByText('Reels Inspo', { selector: '[data-slot=saved-watch-row] *' })
    ).closest('[data-slot=saved-watch-row]') as HTMLElement;
    const watchSwitch = within(row).getByRole('switch', { name: 'Watch this collection' });
    // Read new reels automatically opens under it only once the collection is watched (the kit's Collapse).
    expect(within(row).queryByRole('switch', { name: 'Read new reels automatically' })).toBeNull();

    fireEvent.click(watchSwitch);
    await waitFor(() => expect(watchSwitch.getAttribute('aria-checked')).toBe('true'));
    const autoSwitch = await within(row).findByRole('switch', { name: 'Read new reels automatically' });
    expect(autoSwitch.getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(autoSwitch);
    await waitFor(() => expect(autoSwitch.getAttribute('aria-checked')).toBe('true'));

    // Undo restores autoBreakdown to false.
    await client.commands.undo({ projectId: null });
    await waitFor(() => expect(autoSwitch.getAttribute('aria-checked')).toBe('false'));
    expect(controls.dispatched.some((d) => d.name === 'instagramSaved.setWatch')).toBe(true);

    // Back on the collection, "Read this reel" opens chat with the Reel permalink in the composer.
    await act(async () => {
      await router.navigate({ to: '/templates/saved/$collectionId', params: { collectionId: 'col_inspo' } });
    });
    await screen.findByText('Golden hour street cuts synced to the snare');
    const readButtons = screen.getAllByRole('button', { name: 'Read this reel' });
    fireEvent.click(readButtons[0]!);
    const composer = (await screen.findByRole('textbox', { name: /Message/i })) as HTMLTextAreaElement;
    expect(composer.value).toContain('https://www.instagram.com/reel/REEL_INSPO_1/');
  });
});
