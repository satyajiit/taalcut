// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The chat composer on the fake backend: the model button is Settings' agent
// job (one setting for every chat, the same undoable command), its menu offers
// what is connected and downloaded; the thinking level belongs to the chat,
// goes with each message and comes back with the chat's history, and the
// slider has exactly the model's levels under its provider's names (UX3-AGT).
import { MODEL_COMMANDS, type ConversationId } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { renderApp } from './render-app';

const SEEDED = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6' as ConversationId;

const modelButton = () => screen.findByRole('button', { name: /^Model:/ });
const thinkingButton = () => screen.findByRole('button', { name: /^Thinking:/ });

async function openMenu() {
  fireEvent.click(await modelButton());
  return screen.findByRole('listbox', { name: 'Models' });
}

describe('the composer’s model menu', () => {
  it('offers connected accounts’ models and the downloaded on-device one, and switches with Settings’ undoable command', async () => {
    const { controls, client } = await renderApp('/chat');
    await waitFor(async () => expect((await modelButton()).textContent).toMatch(/GPT-6\.1 Sol\s*OpenAI/));

    // Nothing connected yet: the model in use, this Mac's model, and a way to connect more.
    let menu = await openMenu();
    expect(
      within(menu)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['GPT-6.1 Sol', 'Qwen3.5 4B', 'Connect more…']);
    fireEvent.click(await modelButton());

    // A key added in Settings: its models are offered at once, under their provider.
    await act(async () => void controls.accounts.setApiKey('anthropic', 'sk-ant-test-key'));
    await waitFor(async () => {
      menu = await openMenu();
      expect(within(menu).getByRole('group', { name: 'Anthropic' })).toBeTruthy();
    });
    const anthropic = within(menu).getByRole('group', { name: 'Anthropic' });
    expect(
      within(anthropic)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Claude Opus 5.5', 'Claude Sonnet 5.5', 'Claude Haiku 5.5']);
    // The 0.8B isn't downloaded on this tier, and Google has no key: neither is offered.
    expect(within(menu).queryByRole('option', { name: /0\.8B|Gemini/ })).toBeNull();

    fireEvent.click(within(anthropic).getByRole('option', { name: 'Claude Sonnet 5.5' }));
    await waitFor(async () =>
      expect((await modelButton()).textContent).toMatch(/Claude Sonnet 5\.5\s*Anthropic/),
    );
    expect(controls.dispatched.at(-1)).toEqual({ name: MODEL_COMMANDS.setModuleOverride, source: 'ui' });
    // The next model call uses it, with the job's thinking level kept.
    expect(controls.call('agent')).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      reasoning: 'medium',
    });

    // Undo (⌘K, the Edit menu) puts it back, and the button follows.
    await act(async () => void (await client.commands.undo({ projectId: null })));
    await waitFor(async () => expect((await modelButton()).textContent).toMatch(/GPT-6\.1 Sol/));
  });

  it('“Connect more…” opens Settings → Models with every job’s choices', async () => {
    const { router } = await renderApp('/chat');
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole('option', { name: 'Connect more…' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/models'));
    expect(router.state.location.search).toMatchObject({ advanced: true });
  });
});

describe('the composer’s thinking level', () => {
  it('starts at the model’s own level in a new chat', async () => {
    await renderApp('/chat');
    await waitFor(async () => expect((await thinkingButton()).textContent).toMatch(/Medium/));
  });

  it('comes back with the chat, and goes with each message as the exact level', async () => {
    const { chat } = await renderApp(`/chat/${SEEDED}`);
    // The chat's last picked level, kept with its runs.
    await waitFor(async () => expect((await thinkingButton()).textContent).toMatch(/High/));
    const send = vi.spyOn(chat, 'send');

    fireEvent.click(await thinkingButton());
    const slider = await screen.findByRole('slider', { name: 'Thinking' });
    // GPT-6.1 Sol's reasoning efforts: Low to Max.
    expect(slider.getAttribute('aria-valuemax')).toBe('4');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Max');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Extra high');
    fireEvent.keyDown(slider, { key: 'Escape' });

    const box = screen.getByRole('textbox', { name: 'Message Taalcut' });
    fireEvent.change(box, { target: { value: 'Shorter, please.' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      conversationId: SEEDED,
      text: 'Shorter, please.',
      reasoning: 'xhigh',
    });
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('effort');
  });

  it('has only the levels Google gives Gemini 3.8 Flash, Low to High', async () => {
    const { controls } = await renderApp(`/chat/${SEEDED}`);
    await act(async () => void controls.accounts.setApiKey('google', 'google-test-key'));
    await waitFor(async () => {
      const menu = await openMenu();
      fireEvent.click(within(menu).getByRole('option', { name: 'Gemini 3.8 Flash' }));
    });
    await waitFor(async () => expect((await modelButton()).textContent).toMatch(/Gemini 3\.8 Flash/));
    fireEvent.click(await thinkingButton());
    const slider = within(await screen.findByRole('dialog', { name: 'Thinking' })).getByRole('slider');
    expect(slider.getAttribute('aria-valuemax')).toBe('2');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider.getAttribute('aria-valuetext')).toBe('High');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Low');
  });

  it('calls no reasoning None on OpenAI’s GPT-6 Luna', async () => {
    const { controls } = await renderApp('/chat');
    await act(async () => void controls.accounts.setApiKey('openai', 'sk-openai-test-key'));
    await waitFor(async () => {
      const menu = await openMenu();
      fireEvent.click(within(menu).getByRole('option', { name: 'GPT-6 Luna' }));
    });
    await waitFor(async () => expect((await modelButton()).textContent).toMatch(/GPT-6 Luna/));
    fireEvent.click(await thinkingButton());
    const slider = await screen.findByRole('slider', { name: 'Thinking' });
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider.getAttribute('aria-valuetext')).toBe('None');
  });

  it('keeps the picked thinking level across conversations and the video editor without rolling back', async () => {
    const { router, chat } = await renderApp('/chat');
    const send = vi.spyOn(chat, 'send');
    await waitFor(async () => expect((await thinkingButton()).textContent).toMatch(/Medium/));

    fireEvent.click(await thinkingButton());
    const slider = await screen.findByRole('slider', { name: 'Thinking' });
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Extra high');
    fireEvent.keyDown(slider, { key: 'Escape' });

    // Switching to an earlier conversation whose saved level was High keeps Extra high.
    await act(async () => {
      await router.navigate({ to: '/chat/$conversationId', params: { conversationId: SEEDED } });
    });
    await waitFor(async () => expect((await thinkingButton()).textContent).toMatch(/Extra high/));

    // Switching to the video editor keeps Extra high in the docked chat composer and sends with it.
    await act(async () => {
      await router.navigate({
        to: '/projects/$projectId/timeline',
        params: { projectId: GOLDEN_PROJECT },
        search: { timeline: GOLDEN_TIMELINES[0]! },
      });
    });
    await waitFor(async () => expect((await thinkingButton()).textContent).toMatch(/Extra high/));

    const box = await screen.findByRole('textbox', { name: 'Message Taalcut' });
    fireEvent.change(box, { target: { value: 'Trim the opening clip.' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({
      text: 'Trim the opening clip.',
      reasoning: 'xhigh',
    });
  });
});

describe('the composer’s Effects picker', () => {
  it('tags single or multiple video effects onto a message and sends them as effect selections', async () => {
    const { chat } = await renderApp(`/chat/${SEEDED}`);
    const send = vi.spyOn(chat, 'send');

    const effectsBtn = await screen.findByRole('button', { name: /Effects/i });
    fireEvent.click(effectsBtn);
    const menu = await screen.findByRole('menu', { name: /Effects/i });

    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Word-by-word title' }));
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Whip pan' }));
    fireEvent.keyDown(menu, { key: 'Escape' });

    await waitFor(() =>
      expect(document.querySelectorAll('[data-slot="selection-chip"][data-kind="effect"]')).toHaveLength(2),
    );

    const box = screen.getByRole('textbox', { name: 'Message Taalcut' });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      conversationId: SEEDED,
      text: 'Apply effects: Word-by-word title, Whip pan',
      selections: [
        { kind: 'effect', effectId: 'kineticTitle' },
        { kind: 'effect', effectId: 'whipPan' },
      ],
    });
  });
});
