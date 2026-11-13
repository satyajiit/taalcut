// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2-DOWNLOADER: the window bar shows the download of everything this Mac needs on every page in the shell: a ring
// with the percent while it downloads, its state in words for screen readers, the success mark when it finishes in
// front of you, and nothing at all while everything is here.
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeOnboardingOptions } from '../../src/backend/fake/fake-onboarding';
import { renderWith } from '../onboarding/render-with';

const indicator = () => document.querySelector<HTMLElement>('[data-slot=downloads-indicator]');

function at(onboarding: FakeOnboardingOptions) {
  return renderWith('/library', { phase2b: { onboarding: { downloadTickMs: 0, ...onboarding } } });
}

describe('the window bar’s downloads', () => {
  it('shows nothing while everything this Mac needs is here', async () => {
    await at({});
    await screen.findByRole('banner');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(indicator()).toBeNull();
  });

  it('says how far the download has got, and opens its popover from the bar', async () => {
    await at({ scenario: 'fresh', downloads: 'midway', downloadTickMs: 600_000, saved: done });
    const button = await screen.findByRole('button', { name: /^Downloading models, \d+%$/ });
    expect(indicator()?.dataset['state']).toBe('downloading');
    const popover = document.getElementById(button.getAttribute('popovertarget') ?? '');
    expect(popover?.getAttribute('popover')).toBe('auto');
    // Closed, it is no dialog: pages' Escape and player keys would take it for an open layer.
    expect(popover?.getAttribute('role')).toBeNull();
    // Its rows are the download's; the licences of the parts already here are Settings › Models' (round 3). jsdom
    // has no popover API: the toggle event the browser sends is sent here.
    await act(async () => {
      popover?.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'open' }));
    });
    await waitFor(() => expect(popover?.querySelector('li[data-job="speech"]')).toBeTruthy());
    expect(popover?.getAttribute('role')).toBe('dialog');
    expect(popover?.querySelector('[data-slot=licence-link]')).toBeNull();
  });

  it('asks for the models when they aren’t here, and marks the end of a download it watched', async () => {
    // Ticks a frame apart: the bar sees the download run before it ends.
    const { controls } = await at({ models: 'missing', downloadTickMs: 20 });
    await screen.findByRole('button', { name: 'Models not downloaded' });
    await act(async () => {
      await controls.bus.dispatch('components.download', {}, { source: 'ui', actor: 'user' });
    });
    await waitFor(() => expect(indicator()?.dataset['state']).toBe('ready'));
    expect(screen.getByRole('button', { name: 'Models downloaded' })).toBeTruthy();
  });
});

const done = {
  step: 'first-video' as const,
  startedAt: 0,
  completedAt: 1,
  branch: {},
  completedVia: 'finished' as const,
};
