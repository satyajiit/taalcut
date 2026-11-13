// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B3, docs/onboarding.md section 4, UX4: how Taalcut thinks is no longer a step. When nothing can think yet, the
// last step's Kaatu moment says so and opens the ways to connect; each leads to a working model before Make my first
// video; the subscriptions sign in only after their warning's "I understand"; Local only is its two person
// commands. A way that worked stays in view.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../render-app';
import { el, freshMac, openWay, press } from './onboarding-dom';

const makeIt = () => el('[data-action="make-first-video"]');
/** Something can think: the moment that asked has gone. */
const thinks = () => document.querySelector('[data-slot=quiet-check]') === null;

/** The last step on a fresh Mac, with the ways to connect open under Kaatu's moment. */
async function waysToThink() {
  const app = await renderApp('/onboarding/first-video', freshMac());
  await waitFor(() => el('[data-slot=quiet-check][data-need=thinking]'));
  await press('[data-action="quiet-check-open"]');
  return app;
}

describe('first run › when nothing can think yet', () => {
  it('Make my first video waits for a way that works; ChatGPT signs in through the browser', async () => {
    const { controls } = await renderApp('/onboarding/first-video', freshMac());
    await screen.findByRole('heading', { level: 1, name: 'Make your first video' });
    await press('li[data-path="describe"] > button');
    await act(async () => {
      fireEvent.change(el('[data-slot=describe-panel] textarea'), { target: { value: 'My Goa trip' } });
    });
    await waitFor(() => expect(makeIt().hasAttribute('disabled')).toBe(true));
    expect(el('[data-slot=step-waiting]').textContent).toBe('Choose how Taalcut thinks first.');
    await press('[data-action="quiet-check-open"]');
    await openWay('chatgpt');
    await press('[data-action="chatgpt-sign-in"]');
    await waitFor(() => expect(makeIt().hasAttribute('disabled')).toBe(false));
    expect(controls.accounts.watch.get().chatgpt.signedIn).toBe(true);
    expect(controls.onboarding.progress().branch).toMatchObject({ thinking: 'chatgpt' });
    // The way that worked stays in view; the moment moves on to the video.
    expect(el('li[data-way="chatgpt"]').textContent).toContain('Using ChatGPT plan');
    expect(el('[data-slot=step-moment]').textContent).toContain('That’s all it takes');
  });

  it('another subscription signs in only after its warning’s “I understand”', async () => {
    const { controls } = await waysToThink();
    await openWay('subscription');
    const signIn = await waitFor(() => el('li[data-way="subscription"] button[data-provider]'));
    const provider = signIn.dataset.provider;
    await act(async () => {
      fireEvent.click(signIn);
    });
    await waitFor(() => el('[data-action="acknowledge"]'));
    const signedIn = () =>
      controls.accounts.watch.get().subscriptions.find((each) => each.provider === provider)?.signedIn;
    expect(signedIn()).toBe(false);
    expect(thinks()).toBe(false);
    await press('[data-action="acknowledge"]');
    await waitFor(() => expect(signedIn()).toBe(true));
    await waitFor(() => expect(thinks()).toBe(true));
  });

  it('an API key: a bad one says what to do, a good one works', async () => {
    await waysToThink();
    await openWay('api-key');
    const key = await waitFor(() => el('li[data-way="api-key"] input[type=password]'));
    await act(async () => {
      fireEvent.change(key, { target: { value: 'sk-bad-123' } });
    });
    await press('[data-action="test-key"]');
    await screen.findByRole('alert');
    expect(thinks()).toBe(false);
    await act(async () => {
      fireEvent.change(key, { target: { value: 'sk-good-123' } });
    });
    await press('[data-action="test-key"]');
    await waitFor(() => expect(thinks()).toBe(true));
    expect(screen.getAllByText(/Key works/).length).toBeGreaterThan(0);
  });

  it('Local only is its two person commands, and says what changes on this Mac', async () => {
    const { controls } = await waysToThink();
    await openWay('local-only');
    await press('[data-action="local-only"]');
    await waitFor(() => expect(thinks()).toBe(true));
    const sent = controls.dispatched.filter((each) =>
      ['privacy.setLocalOnly', 'models.setProfile'].includes(each.name),
    );
    expect(sent.map((each) => each.name).sort()).toEqual(['models.setProfile', 'privacy.setLocalOnly']);
    expect(sent.every((each) => each.source === 'ui')).toBe(true);
    expect(controls.privacy.state().localOnly).toBe(true);
    // What Local only changes on this tier, in words (G27's lower-quality labels).
    expect(await screen.findByText('Voice is off with Local only')).toBeTruthy();
  });

  it('offline: the signing-in ways say why they wait; Local only stays open', async () => {
    const online = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    try {
      await waysToThink();
      await waitFor(() => expect(el('li[data-way="api-key"] > button').hasAttribute('disabled')).toBe(true));
      expect(el('li[data-way="subscription"] > button').hasAttribute('disabled')).toBe(true);
      expect(el('li[data-way="local-only"] > button').hasAttribute('disabled')).toBe(false);
      expect(screen.getAllByText('Connect to the internet to sign in.').length).toBeGreaterThan(0);
    } finally {
      if (online) Object.defineProperty(window.navigator, 'onLine', online);
    }
  });
});
