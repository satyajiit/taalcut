// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B14, P3-B3 (the window's part): About offers Send feedback, says where crash reports are set, and runs
// first run again through onboarding.reset.
import { ONBOARDING_COMMANDS } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { closeFeedback } from '../../src/features/feedback/feedback-state';
import { renderApp } from '../render-app';

// Send feedback's open state lives outside React (one dialog per window): each test starts closed.
afterEach(() => closeFeedback());

const help = async () => within(await screen.findByRole('list', { name: 'Feedback and setup' }));

describe('Settings › About › Feedback and setup', () => {
  it('Send feedback opens the feedback dialog; on the beta it says notes shape what comes next', async () => {
    await renderApp('/settings/about', { phase3: { updates: { channel: 'beta' } } });
    const rows = await help();
    // The wording follows the update state, which arrives after the list renders.
    await rows.findByText(/You’re on an early version/, undefined, { timeout: 5000 });
    await act(async () => {
      fireEvent.click(rows.getByRole('button', { name: 'Send feedback…' }));
    });
    await screen.findByRole('dialog', { name: 'Send feedback' }, { timeout: 5000 });
  });

  it('crash reports are a fact here, changed in Privacy', async () => {
    const { router } = await renderApp('/settings/about', {
      phase2b: { privacy: { crashReports: { enabled: true, changedAt: 0 } } },
    });
    const rows = await help();
    await rows.findByText(/Crash reports are on/);
    const link = rows.getByRole('link', { name: /Change in Privacy/ });
    // UX4 set: Help improve is Privacy's Sharing view.
    expect(link.getAttribute('href')).toBe('/settings/privacy/sharing#help-improve');
    await act(async () => {
      fireEvent.click(link);
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/privacy/sharing'));
    await waitFor(() => expect(document.getElementById('help-improve')).not.toBeNull());
  });

  it('with Local only on, crash reports say they are paused', async () => {
    await renderApp('/settings/about', {
      phase2b: { privacy: { crashReports: { enabled: true, changedAt: 0 }, localOnly: true } },
    });
    const rows = await help();
    await rows.findByText('Crash reports are on, and paused while Local only is on.');
  });

  it('Run setup again resets first run as the person and opens it', async () => {
    const { controls, router } = await renderApp('/settings/about');
    const rows = await help();
    await act(async () => {
      fireEvent.click(rows.getByRole('button', { name: 'Run setup again' }));
    });
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/onboarding/));
    expect(controls.dispatched).toContainEqual({ name: ONBOARDING_COMMANDS.reset, source: 'ui' });
  });
});
