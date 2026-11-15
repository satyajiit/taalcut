// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// CVR2: the ChatGPT plan's images are a second approval at OpenAI. When that half ends without connecting, the
// Accounts row says why and offers it again, the Connected view says it too, and the fix on
// models.chatgpt_images_not_connected ("Connect ChatGPT images") opens that row and starts the sign-in.
import { CHATGPT_IMAGE_PROVIDER, SETTINGS_COMMANDS } from '@taalcut/core';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../render-app';

const row = () => document.querySelector(`[data-provider="${CHATGPT_IMAGE_PROVIDER}"]`) as HTMLElement;

describe('ChatGPT images, the second approval', () => {
  it('says why they did not connect, in the row, and connects them when asked again', async () => {
    const { controls, client } = await renderApp('/settings/accounts/subscriptions');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with ChatGPT' }));
    await screen.findByText('Using ChatGPT plan');

    // The page in the browser was closed: the sign-in times out, and the row says so.
    controls.accounts.failNextImagesSignIn('models.sign_in_timeout');
    fireEvent.click(screen.getByRole('button', { name: 'Connect ChatGPT images' }));
    await waitFor(() => expect(row().textContent).toContain('Not connected'));
    expect(row().textContent).toContain('ChatGPT images sign-in wasn’t finished in time');
    expect((await client.accounts.state()).chatgpt.imagesAttempt).toMatchObject({
      state: 'failed',
      errorCode: 'models.sign_in_timeout',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Connect ChatGPT images' }));
    await screen.findByText('Images connected');
    expect(row().textContent).not.toContain('Not connected');
    expect((await client.accounts.state()).chatgpt.imagesAttempt).toBeUndefined();
  });

  it('says it on Connected too, where Continue with ChatGPT was pressed', async () => {
    const { controls, client } = await renderApp('/settings/accounts');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with ChatGPT' }));
    await screen.findByText('Using ChatGPT plan');
    expect(screen.queryByText('ChatGPT images')).toBeNull();

    controls.accounts.failNextImagesSignIn('models.sign_in_failed');
    await act(async () => {
      await client.accounts.signIn({ provider: CHATGPT_IMAGE_PROVIDER }).catch(() => undefined);
    });
    expect(await screen.findByText('ChatGPT images')).toBeTruthy();
    expect(await screen.findByText('Signing in to ChatGPT images didn’t work. Try again.')).toBeTruthy();
    expect(screen.getByText('Not connected')).toBeTruthy();
  });

  it('the fix opens the row and starts the images sign-in in one click', async () => {
    const { controls, client, router } = await renderApp('/chat');
    await act(async () => {
      await client.accounts.signIn({ provider: 'openai-codex' });
    });
    // The palette's chunk, which runs ui.action, loads right after the first frame: sent until it is carried out.
    await waitFor(() => {
      controls.events.emit('ui.action', { action: SETTINGS_COMMANDS.connectChatGptImages });
      expect(router.state.location.pathname).toBe('/settings/accounts/subscriptions');
    });
    await screen.findByText('Images connected');
    expect((await client.accounts.state()).chatgpt).toMatchObject({ signedIn: true, imagesSignedIn: true });
  });
});
