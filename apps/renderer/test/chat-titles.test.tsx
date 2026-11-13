// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The agent names a chat after its first exchange and says so with
// library.changed (entity conversation): the window bar and the chat list
// follow live, with no reload.
import type { ConversationId } from '@taalcut/core';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from './render-app';

const SEEDED = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6' as ConversationId;

describe('chat titles', () => {
  it('a title the agent writes shows in the window bar and the chat list at once', async () => {
    const { controls, chat } = await renderApp(`/chat/${SEEDED}`);
    expect(await screen.findByRole('heading', { level: 1, name: /Trip to Goa reel/ })).toBeTruthy();
    const chats = screen.getByRole('region', { name: 'Recent chats' });
    await within(chats).findByRole('link', { name: /Trip to Goa reel/ });

    expect(chat.rename(SEEDED, 'Goa sunset cut')).toBe(true);
    await act(async () => {
      controls.events.emit('library.changed', {
        projectId: null,
        entity: 'conversation',
        change: 'updated',
        ids: [SEEDED],
      });
    });

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: /Goa sunset cut/ })).toBeTruthy(),
    );
    await within(chats).findByRole('link', { name: /Goa sunset cut/ });
    // The transcript stayed as it was: only the summary was fetched again.
    expect(screen.getAllByText('What happens in IMG_0418?').length).toBeGreaterThan(0);
  });

  it('ignores other entities and other chats', async () => {
    const { controls, chat } = await renderApp(`/chat/${SEEDED}`);
    await screen.findByRole('heading', { level: 1, name: /Trip to Goa reel/ });
    chat.rename(SEEDED, 'Not announced');
    await act(async () => {
      controls.events.emit('library.changed', {
        projectId: null,
        entity: 'asset',
        change: 'updated',
        ids: [SEEDED],
      });
    });
    expect(screen.getByRole('heading', { level: 1, name: /Trip to Goa reel/ })).toBeTruthy();
  });
});
