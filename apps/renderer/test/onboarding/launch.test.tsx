// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1 (W2-6): launching never shows a blank window and never skips first run quietly. While Taalcut reads where
// first run got to, the window shows bones of the screen it will most likely open on (after a short wait); a failed
// read says so, with Try again and the way into the app.
import { TimeoutError } from '@taalcut/core';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { writeLaunchHint } from '../../src/onboarding/launch-hint';
import { freshMac, press } from './onboarding-dom';
import { renderWith } from './render-with';

const slow = { 'onboarding.state': { delayMs: 600 } };

describe('launch', () => {
  it('a slow read shows the welcome’s bones on a fresh profile, then the welcome', async () => {
    const { router } = await renderWith('/', freshMac(), slow);
    // Nothing for the first moments: a quick launch never flashes bones.
    expect(document.querySelector('[data-slot=launch-skeleton]')?.textContent).toBe('');
    await waitFor(() =>
      expect(document.querySelector('[data-slot=launch-skeleton] [role=status]')?.textContent).toBe(
        'Loading',
      ),
    );
    expect(document.querySelector('[data-slot=sidebar]')).toBeNull();
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding'));
  });

  it('after first run, a slow read shows the app’s shape (the sidebar) while it reads', async () => {
    writeLaunchHint('app');
    const { router } = await renderWith('/', {}, slow);
    await waitFor(() =>
      expect(document.querySelector('[data-slot=launch-skeleton] [data-slot=sidebar]')).not.toBeNull(),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
  });

  it('remembers where the launch went, so the next one guesses right', async () => {
    await renderWith('/', {});
    await waitFor(() => expect(window.localStorage.getItem('taalcut.launch')).toBe('app'));
  });

  it('a failed read says so, with Try again; first run isn’t skipped', async () => {
    const { router } = await renderWith('/', freshMac(), {
      'onboarding.state': { error: TimeoutError({ ms: 5000 }), times: 1 },
    });
    await screen.findByRole('heading', { level: 1, name: 'Taalcut couldn’t check your setup' });
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('alert').textContent).not.toBe('');
    expect(screen.getByRole('link', { name: 'Open Taalcut' }).getAttribute('href')).toBe('/chat');
    await press('[data-action="retry-launch"]');
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding'));
  });
});
