// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-AGT: Settings › Accounts names where keys and sign-ins are kept as the system that keeps them: the Mac's
// keychain on a Mac, the system keyring (GNOME Keyring through libsecret) on Linux, and never "this Mac" off one.
import { i18n } from '@lingui/core';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { describeError, translateKey } from '../../src/features/settings/model-messages';
import { msg } from '@lingui/core/macro';
import { activateLocale } from '../../src/i18n/i18n';
import { renderApp } from '../render-app';

const MAC_WORDS = /\bMac\b|Mac’s|macOS|Keychain|keychain/;

describe('Settings › Accounts on Linux', () => {
  it('keeps keys and sign-ins in the system keyring, in every view', async () => {
    await renderApp('/settings/accounts/keys', {}, 'en', 'linux');
    const keys = await screen.findByRole('region', { name: 'API keys' });
    expect(keys.textContent).toContain('Keys stay in your system keyring.');

    // The open form is in the address (?add=), so it opens once the router has moved.
    fireEvent.click(within(keys).getAllByRole('button', { name: 'Add key' })[0]!);
    expect(
      await within(keys).findByText('Kept in your system keyring. Taalcut never shows it again.'),
    ).toBeTruthy();
    expect(document.querySelector('main')?.textContent).not.toMatch(MAC_WORDS);
  });

  it('says this computer, not this Mac, for your own servers and on the Connected view', async () => {
    await renderApp('/settings/accounts/servers', {}, 'en', 'linux');
    const servers = await screen.findByRole('region', { name: 'Advanced: bring your own server' });
    expect(servers.textContent).toContain('Taalcut already runs models on this computer');
    expect(document.querySelector('main')?.textContent).not.toMatch(MAC_WORDS);
  });

  it('Connected names Instagram by its row and sends its sign-in to Saved', async () => {
    await renderApp('/settings/accounts', {}, 'en', 'linux');
    const instagram = await screen.findByRole('region', { name: 'Saved on Instagram' });
    // One sign-in, in Templates › Saved: Accounts only says how it stands and goes there.
    expect(within(instagram).queryByRole('button', { name: 'Sign in to Instagram' })).toBeNull();
    expect(within(instagram).getByRole('link', { name: 'Open Saved' }).getAttribute('href')).toBe(
      '/templates/saved',
    );
    expect(document.querySelector('main')?.textContent).not.toMatch(MAC_WORDS);
  });

  it('says the system keyring when a key can’t be kept, and the Mac’s keychain on a Mac', async () => {
    await activateLocale('en');
    const error = { messageKey: 'errors.models.secret_store_failed' };
    expect(describeError(i18n, error, 'linux')).toBe(
      'Couldn’t reach the system keyring, where Taalcut keeps your keys and sign-ins. Check that it’s unlocked, then try again.',
    );
    expect(describeError(i18n, error, 'mac')).toBe(
      'Couldn’t reach your Mac’s keychain, where Taalcut keeps your keys and sign-ins. Try again.',
    );
    const body = translateKey(i18n, 'templates.warning.instagram.body', msg`unused`, 'linux');
    expect(body).not.toMatch(MAC_WORDS);
  });
});

describe('Settings › Accounts on a Mac', () => {
  it('still says the Mac’s keychain', async () => {
    await renderApp('/settings/accounts/keys');
    const keys = await screen.findByRole('region', { name: 'API keys' });
    expect(keys.textContent).toContain('Keys stay in your Mac’s keychain.');
  });
});

describe('a model nobody set up', () => {
  it('asks for a sign-in or a key, not only a key (a ChatGPT plan is a sign-in)', async () => {
    await activateLocale('en');
    expect(describeError(i18n, { messageKey: 'errors.models.not_configured' }, 'linux')).toBe(
      'This model isn’t set up. Sign in or add a key for it in Accounts, then try again.',
    );
  });
});
