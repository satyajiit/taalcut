// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P1-H5 "Done when": changing a module's model in Settings changes the next
// call. Here against the fake backend in jsdom; e2e/settings.spec.ts does the
// same in the built app through a backend driver that can switch to the real one.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from './render-app';

describe('Settings › Models', () => {
  it('changing a job’s model changes the next call, and undo puts it back', async () => {
    const { controls, client } = await renderApp('/settings/models?advanced=true', {
      interfaceSounds: { saved: { enabled: true, initialized: true } },
    });
    expect(controls.call('agent')).toMatchObject({
      provider: 'openai',
      model: 'gpt-6.1-sol',
      reasoning: 'medium',
    });

    const agent = await screen.findByRole('region', { name: 'Agent' });
    fireEvent.change(within(agent).getByLabelText('Model'), {
      target: { value: 'anthropic/claude-opus-5-5' },
    });
    await within(agent).findByText('You changed this');
    expect(controls.call('agent')).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      reasoning: 'medium',
    });

    fireEvent.change(within(agent).getByLabelText('Thinking'), { target: { value: 'high' } });
    await waitFor(() => expect(controls.call('agent')).toMatchObject({ reasoning: 'high' }));

    await client.commands.undo({ projectId: null });
    await client.commands.undo({ projectId: null });
    await waitFor(() => expect(within(agent).queryByText('You changed this')).toBeNull());
    expect(controls.call('agent')).toMatchObject({ model: 'gpt-6.1-sol' });
    expect(controls.dispatched.map((d) => [d.name, d.source])).toEqual([
      ['models.setModuleOverride', 'ui'],
      ['models.setModuleOverride', 'ui'],
    ]);
  });

  it('offers exactly the model’s thinking levels, under its provider’s names', async () => {
    await renderApp('/settings/models?advanced=true');
    const agent = await screen.findByRole('region', { name: 'Agent' });
    const levels = () =>
      within(within(agent).getByLabelText('Thinking'))
        .getAllByRole('option')
        .map((o) => o.textContent);
    // GPT-6.1 Sol's reasoning efforts, as OpenAI names them.
    await waitFor(() => expect(levels()).toEqual(['Low', 'Medium', 'High', 'Extra high', 'Max']));
    fireEvent.change(within(agent).getByLabelText('Model'), { target: { value: 'google/gemini-3.8-flash' } });
    await waitFor(() => expect(levels()).toEqual(['Low', 'Medium', 'High']));
    // GPT-6 Luna can skip reasoning: OpenAI calls that None.
    fireEvent.change(within(agent).getByLabelText('Model'), { target: { value: 'openai/gpt-6-luna' } });
    await waitFor(() => expect(levels()).toEqual(['None', 'Low', 'Medium', 'High', 'Extra high', 'Max']));
  });

  it('switching profile is live: the next call uses it, and a switch from elsewhere shows at once', async () => {
    const { controls, client } = await renderApp('/settings/models');
    fireEvent.click(await screen.findByRole('radio', { name: 'Fast and cheap' }));
    // The kit's Radix radio says its state in aria-checked.
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Fast and cheap' }).getAttribute('aria-checked')).toBe('true'),
    );
    expect(controls.call('agent')).toMatchObject({ model: 'claude-haiku-5-5' });

    // ⌘K or the agent switching profile: the page follows models.changed.
    await client.commands.dispatch({ name: 'models.setProfile', payload: { profileId: 'best-quality' } });
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Best quality' }).getAttribute('aria-checked')).toBe('true'),
    );
  });

  it('shows the deprecation notice and switches to the replacement', async () => {
    const { controls } = await renderApp('/settings/models');
    expect(await screen.findByText(/GPT Image 1/)).toBeTruthy();
    expect(controls.call('images')).toMatchObject({ model: 'openai/gpt-image-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Switch now' }));
    await waitFor(() => expect(controls.call('images')).toMatchObject({ model: 'openai/gpt-image-2' }));
  });
});

// UX4 set: Accounts' views are pages of their own (Keys, Subscriptions, Servers).
describe('Settings › Accounts', () => {
  it('keeps API keys write-only: saved, tested, never shown again', async () => {
    await renderApp('/settings/accounts/keys');
    const keys = await screen.findByRole('region', { name: 'API keys' });
    fireEvent.click(within(keys).getAllByRole('button', { name: 'Add key' })[0]!);
    // The form opens through the address (?add=), so after a navigation.
    const field = (await within(keys).findByLabelText('OpenAI API key')) as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.change(field, { target: { value: 'sk-secret-123456789' } });
    fireEvent.click(within(keys).getByRole('button', { name: 'Save key' }));
    await within(keys).findByText('Saved, not tested');
    expect(document.body.innerHTML).not.toContain('sk-secret');
    fireEvent.click(within(keys).getByRole('button', { name: 'Test' }));
    await within(keys).findByText(/Works/);
  });

  it('uses OpenAI’s exact words for ChatGPT', async () => {
    await renderApp('/settings/accounts/subscriptions');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with ChatGPT' }));
    expect(await screen.findByText('Using ChatGPT plan')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Manage usage/ }).getAttribute('target')).toBe('_blank');
  });

  it('connects and disconnects ChatGPT images without changing the chat connection', async () => {
    const { client } = await renderApp('/settings/accounts/subscriptions');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with ChatGPT' }));
    await screen.findByText('Using ChatGPT plan');
    fireEvent.click(screen.getByRole('button', { name: 'Connect ChatGPT images' }));
    await screen.findByText('Images connected');
    expect((await client.accounts.state()).chatgpt).toMatchObject({ signedIn: true, imagesSignedIn: true });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect images' }));
    await screen.findByRole('button', { name: 'Connect ChatGPT images' });
    expect((await client.accounts.state()).chatgpt).toMatchObject({ signedIn: true, imagesSignedIn: false });
  });

  it('keeps the chat login disabled while the image login is pending', async () => {
    const { client } = await renderApp('/settings/accounts/subscriptions');
    fireEvent.click(await screen.findByRole('button', { name: 'Connect ChatGPT images' }));
    const chatLogin = screen.getByRole('button', { name: 'Continue with ChatGPT' });
    expect(chatLogin.hasAttribute('disabled')).toBe(true);
    fireEvent.click(chatLogin);
    await screen.findByText('Images connected');
    expect((await client.accounts.state()).chatgpt).toMatchObject({ signedIn: false, imagesSignedIn: true });
  });

  it('refuses a server address with a user name or password, and says why under the field', async () => {
    const { client } = await renderApp('/settings/accounts/servers');
    const field = await screen.findByLabelText('Ollama address');
    fireEvent.change(field, { target: { value: 'http://me:hunter2@localhost:11434' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Use this server' })[0]!);
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
    const hint = document.getElementById(field.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toBe(
      'Taalcut doesn’t keep passwords in server addresses. Remove the user name and password from the address, then try again.',
    );
    const ollama = (await client.accounts.state()).localServers.find((s) => s.kind === 'ollama');
    expect(ollama?.baseUrl).toBeUndefined();

    // Editing the address clears the refusal.
    fireEvent.change(field, { target: { value: 'http://localhost:11434' } });
    expect(field.getAttribute('aria-invalid')).toBeNull();
  });

  it('puts the warning in front of a Claude login, and logs the acknowledgement', async () => {
    const { client } = await renderApp('/settings/accounts/subscriptions');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to Claude' }));
    const card = await screen.findByRole('region', { name: 'Using your Claude plan in Taalcut' });
    expect(card.textContent).toContain('every request tells Anthropic it comes from Claude Code');
    // In plain words: no headers, libraries or client ids (UX1, M24).
    expect(card.textContent).not.toMatch(/headers|pi-ai|client id/);
    expect(within(card).getByRole('button', { name: 'Use an API key instead' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'I understand' }));
    await screen.findByRole('button', { name: 'Sign out of Claude' });
    const claude = (await client.accounts.state()).subscriptions.find((s) => s.provider === 'anthropic');
    expect(claude).toMatchObject({ signedIn: true, acknowledgedAt: expect.any(Number) });

    // Acknowledged once for this terms version: signing in again skips the card.
    fireEvent.click(screen.getByRole('button', { name: 'Sign out of Claude' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to Claude' }));
    await screen.findByRole('button', { name: 'Sign out of Claude' });
    expect(screen.queryByRole('region', { name: 'Using your Claude plan in Taalcut' })).toBeNull();
  });
});

describe('Settings › Privacy', () => {
  it('lists what is sent without asking, and Revoke takes one back at once, with a plain line', async () => {
    const { controls } = await renderApp('/settings/privacy');
    const list = await screen.findByRole('list', { name: 'Steps that send files without asking' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Seeing your clips')).toBeTruthy();
    expect(list.textContent).toContain('Sends files to Google without asking');

    fireEvent.click(within(list).getByRole('button', { name: 'Revoke “Seeing your clips”' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      '“Seeing your clips” will ask again before sending files.',
    );
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(controls.consents.list().map((consent) => consent.module)).toEqual(['speech']);
    // No undo: only a consent card gives consent back.
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });

  it('says when nothing is sent without asking', async () => {
    const { controls } = await renderApp('/settings/privacy');
    await screen.findByRole('list', { name: 'Steps that send files without asking' });
    controls.consents.revoke('vision');
    controls.consents.revoke('speech');
    fireEvent.click(screen.getByRole('link', { name: 'Usage' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Privacy' }));
    // Two page loads in a row (Usage, then Privacy's consents): more than the default second under a loaded
    // machine's full check, where this once timed out (specs/requests-transcript-to-orchestrator.md 4).
    expect(await screen.findByText(/Nothing is sent without asking/, {}, { timeout: 5000 })).toBeTruthy();
  }, 15_000);

  // UX4: Usage, then Privacy, faster than Usage arrives. The Privacy page stays mounted (Usage never showed), so a
  // list read only when it mounted kept the uploads revoked meanwhile until the next visit.
  it('reads the uploads again when Privacy is picked before Usage has arrived', async () => {
    const { controls, router } = await renderApp('/settings/privacy');
    await screen.findByRole('list', { name: 'Steps that send files without asking' });
    controls.consents.revoke('vision');
    controls.consents.revoke('speech');
    const rail = screen.getByRole('navigation', { name: 'Settings' });
    fireEvent.click(within(rail).getByRole('link', { name: 'Usage' }));
    fireEvent.click(within(rail).getByRole('link', { name: 'Privacy' }));
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe('/settings/privacy'));
    expect(await screen.findByText(/Nothing is sent without asking/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Steps that send files without asking' })).toBeNull();
  }, 15_000);
});

describe('Settings route left-side tabs', () => {
  it('renders its own left-side tabs, marks only the open tab current, and links back to the app', async () => {
    await renderApp('/settings/usage');
    const sections = await screen.findByRole('navigation', { name: 'Settings' });
    expect(within(sections).getByRole('link', { name: 'Usage' }).getAttribute('aria-current')).toBe('page');
    expect(within(sections).getByRole('link', { name: 'Models' }).getAttribute('aria-current')).toBeNull();
    const app = screen.getByRole('navigation', { name: 'App' });
    expect(within(app).getByRole('link', { name: 'Back to app' }).getAttribute('href')).toBe('/chat');
    // Main workspace Areas are not crammed into the Settings route sidebar.
    expect(screen.queryByRole('navigation', { name: 'Areas' })).toBeNull();
  });
});
