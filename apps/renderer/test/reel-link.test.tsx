// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// A reel's link goes at once (REF1, the owner's decision of 2026-10-29): no download warning card holds it, in the
// composer or from an opening choice, and the agent reads the reel straight away. Before REF1 the link waited for
// "I understand" on the card; these pin that nothing waits now.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from './render-app';

/** A TikTok share link (vm.tiktok.com) and an Instagram reel: made-up links, never a real post. */
const TIKTOK = 'https://vm.tiktok.com/ZMexample1/';
const INSTAGRAM = 'https://www.instagram.com/reel/EXAMPLE123/';

const userMessages = () => document.querySelectorAll('[data-slot=chat-message][data-role=user]');
const warningCards = () => document.querySelectorAll('[data-slot=warning-card]');

describe('a reel link in the chat', () => {
  it('typed in the composer, it is sent at once', async () => {
    await renderApp('/chat');
    const composer = await screen.findByRole('textbox', { name: 'Message Taalcut' });
    fireEvent.change(composer, { target: { value: `Copy the style of ${TIKTOK}` } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(userMessages()).toHaveLength(1));
    expect(userMessages()[0]?.textContent).toContain(TIKTOK);
    expect(warningCards()).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Download this reel to copy its style?' })).toBeNull();
  });

  it('from Paste a reel, the agent reads it straight away', async () => {
    await renderApp('/chat');
    fireEvent.click(await screen.findByRole('button', { name: /Paste a reel/ }));
    fireEvent.change(await screen.findByLabelText('Link to a reel'), { target: { value: INSTAGRAM } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this reel' }));
    await waitFor(() => expect(userMessages()).toHaveLength(1));
    // The breakdown arrives: the download wasn't stopped for a warning.
    await waitFor(() => expect(document.querySelector('[data-card-type=breakdown]')).not.toBeNull());
    expect(warningCards()).toHaveLength(0);
  });
});
