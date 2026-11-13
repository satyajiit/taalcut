// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B3, docs/onboarding.md sections 7 and 9, UX4: the ways to bring videos in (a folder, the phone on a cable,
// later), with the import shown on the same step; the finish (a reel, a starter or your words, then Make my first
// video); the branch chosen is saved, so a resume reopens it; the steps follow the build.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { CHATGPT_PROVIDER } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { buildTerms, stepsFor } from '../../src/onboarding/steps';
import { renderApp } from '../render-app';
import { continueButton, el, freshMac, openWay, press, startImport } from './onboarding-dom';

const enabled = () => !continueButton().hasAttribute('disabled');
const makeIt = () => el('[data-action="make-first-video"]');
const moment = () => el('[data-slot=step-moment]');
/** Something can think: the ChatGPT plan, signed in behind the page's back (the fake's browser comes back at once). */
const signInChatGpt = (controls: { accounts: { signIn(provider: string): Promise<unknown> } }) =>
  act(async () => {
    await controls.accounts.signIn(CHATGPT_PROVIDER);
  });

describe('first run › Where are your videos?', () => {
  it('a folder: chosen, added, read on the same step (Kaatu says so), and Continue goes on to the first video', async () => {
    const { controls, router } = await renderApp('/onboarding/sources', freshMac());
    await screen.findByRole('heading', { level: 1, name: 'Where are your videos?' });
    expect(enabled()).toBe(false);
    // Before anything comes in, Kaatu's tip.
    await waitFor(() => expect(moment().textContent).toContain('Bring in plenty'));
    await openWay('folder');
    await startImport();
    await waitFor(() => expect(enabled()).toBe(true));
    expect(controls.dispatched.map((each) => each.name)).toContain('imports.start');
    expect(controls.onboarding.progress().branch).toMatchObject({ source: 'folder' });
    expect(await screen.findByRole('region', { name: 'Import progress' })).toBeTruthy();
    await press('[data-action="continue"]');
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/first-video'));
  });

  it('the phone on a cable: found, opened, and an import of the last 30 days enables Continue', async () => {
    await renderApp('/onboarding/sources', freshMac({ phase3: { usb: { scenario: 'iphone', tickMs: 20 } } }));
    await openWay('cable');
    await startImport();
    await waitFor(() => expect(enabled()).toBe(true));
    expect(el('li[data-way="cable"]').textContent).toContain('Import started');
  });

  it('“I’ll add videos later” goes straight to the first video', async () => {
    const { controls, router } = await renderApp('/onboarding/sources', freshMac());
    await press('[data-action="later"]');
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/first-video'));
    expect(controls.onboarding.progress().branch).toMatchObject({ source: 'later' });
  });

  it('a resume reopens the way chosen last time', async () => {
    const fresh = freshMac({ phase3: { usb: { scenario: 'iphone', tickMs: 20 } } });
    await renderApp('/onboarding/sources', {
      ...fresh,
      phase2b: {
        onboarding: {
          ...fresh.phase2b.onboarding,
          saved: {
            step: 'sources',
            startedAt: 1,
            completedAt: null,
            completedVia: null,
            branch: { source: 'cable' },
          },
        },
      },
    });
    await waitFor(() =>
      expect(el('li[data-way="cable"] > button').getAttribute('aria-expanded')).toBe('true'),
    );
  });
});

describe('first run › Make your first video', () => {
  it('a starter: the best fit chosen for you, Make my first video forks it, and the chat opens with it', async () => {
    const { controls, router } = await renderApp(
      '/onboarding/first-video',
      freshMac({ phase2: { library: { count: 120, tickMs: 0 } } }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Make your first video' });
    await signInChatGpt(controls);
    expect(makeIt().hasAttribute('disabled')).toBe(true);
    await press('li[data-path="template"] > button');
    const first = await waitFor(() => el('[data-starter]'));
    expect(first.dataset.starter).toBe('weekend-trip');
    await waitFor(() => expect(el('[data-starter="weekend-trip"] input').matches(':checked')).toBe(true));
    // Ready: Kaatu grins over the one primary.
    await waitFor(() => expect(moment().textContent).toContain('That’s all it takes'));
    await press('[data-action="make-first-video"]');
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/));
    expect(controls.dispatched.map((each) => each.name)).toContain('template.addStarter');
    const progress = controls.onboarding.progress();
    expect(progress.completedAt).not.toBeNull();
    expect(progress.completedVia).toBe('finished');
    expect(progress.branch).toMatchObject({ starterPicker: true });
  });

  it('a reel: its link pasted, Make my first video, and the chat opens following it', async () => {
    const { controls, router } = await renderApp('/onboarding/first-video', freshMac());
    await signInChatGpt(controls);
    await press('li[data-path="reference"] > button');
    const field = await waitFor(() => el<HTMLInputElement>('[data-slot=reel-panel] input'));
    // A word that isn't a link says what to do, under the field.
    await act(async () => {
      fireEvent.change(field, { target: { value: 'my reel' } });
    });
    await press('[data-action="make-first-video"]');
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getByRole('alert').textContent).toContain('Copy link');
    await act(async () => {
      fireEvent.change(field, { target: { value: 'https://www.instagram.com/reel/abc' } });
    });
    await press('[data-action="make-first-video"]');
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/chat\//));
    expect(controls.onboarding.progress().completedVia).toBe('finished');
  });

  it('nothing can think yet: Kaatu says so with the fix a press away, and the primary waits with its reason', async () => {
    await renderApp('/onboarding/first-video', freshMac());
    const check = await waitFor(() => el('[data-slot=quiet-check][data-need=thinking]'));
    expect(check.textContent).toContain('ChatGPT');
    // One line until asked: the reel is the step's decision.
    expect(el('[data-slot=quiet-check-fix]').closest('[inert]')).not.toBeNull();
    await press('li[data-path="describe"] > button');
    await act(async () => {
      fireEvent.change(el('[data-slot=describe-panel] textarea'), { target: { value: 'My Goa trip' } });
    });
    expect(makeIt().hasAttribute('disabled')).toBe(true);
    expect(el('[data-slot=step-waiting]').textContent).toContain('Choose how Taalcut thinks first');
    await press('[data-action="quiet-check-open"]');
    await openWay('chatgpt');
    await press('[data-action="chatgpt-sign-in"]');
    await waitFor(() => expect(makeIt().hasAttribute('disabled')).toBe(false));
    expect(document.querySelector('[data-slot=quiet-check]')).toBeNull();
  });
});

describe('first run’s steps follow the build', () => {
  it('stable: no terms step; beta (or a stable build on the beta channel): the beta step; alpha: the alpha step', () => {
    expect(stepsFor(buildTerms({ channel: 'stable', choice: null }))).toEqual(['sources', 'first-video']);
    expect(stepsFor(buildTerms({ channel: 'stable', choice: 'beta' }))).toContain('beta');
    expect(stepsFor(buildTerms({ channel: 'beta', choice: null }))).toContain('beta');
    const alpha = stepsFor(buildTerms({ channel: 'alpha', choice: null }));
    expect(alpha).toEqual(['sources', 'alpha', 'first-video']);
    expect(stepsFor(buildTerms({ channel: 'beta', choice: null }))).toEqual([
      'sources',
      'beta',
      'first-video',
    ]);
  });
});
