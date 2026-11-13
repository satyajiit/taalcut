// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2-DOWNLOADER, UX4: first run starts the download of everything this Mac needs by itself, on its first step, and
// asks nothing about it. Its state is read once and then follows the download's events; a read that fails is tried
// again by itself (waiting longer each time). Only a download that stopped says so, on the last step, as Kaatu's
// moment: its section (by job, a part that didn't download in words, with Try again) is a press away.
import { CHATGPT_PROVIDER, TimeoutError, type Downloads } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { retryDelay } from '../../src/features/downloads/downloads-store';
import { el, freshMac } from './onboarding-dom';
import { renderWith } from './render-with';

const job = (key: string) => el(`li[data-job="${key}"]`);

/** Something can think, so the download is the one thing the last step's moment could be about. */
async function thinking(controls: { accounts: { signIn(provider: string): Promise<unknown> } }) {
  await act(async () => {
    await controls.accounts.signIn(CHATGPT_PROVIDER);
  });
}

describe('first run › the models for this Mac, quietly', () => {
  it('waits longer after each failed read, up to 8 s', () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it('starts the download by itself on Your videos, once, and asks nothing about it', async () => {
    const { controls } = await renderWith('/onboarding/sources', freshMac());
    await screen.findByRole('heading', { level: 1, name: 'Where are your videos?' });
    await waitFor(() =>
      expect(controls.dispatched.map((each) => each.name)).toContain('components.download'),
    );
    await waitFor(() => expect(controls.onboarding.downloads().state).toBe('ready'));
    expect(controls.dispatched.filter((each) => each.name === 'components.download')).toHaveLength(1);
    // Nothing about it on the steps: no section, no spec sheet.
    expect(screen.queryByRole('region', { name: 'Models for this Mac' })).toBeNull();
    expect(document.querySelector('[data-slot=hardware-row]')).toBeNull();
  });

  it('a download that finished asks nothing on the last step either', async () => {
    const { controls } = await renderWith('/onboarding/first-video', freshMac());
    await thinking(controls);
    await waitFor(() => expect(controls.onboarding.downloads().state).toBe('ready'));
    expect(document.querySelector('[data-slot=quiet-check]')).toBeNull();
  });

  it('a state that can’t be read is read again by itself, and a stopped download still surfaces', async () => {
    const stopped = (value: unknown) => ({ ...(value as Downloads), state: 'failed' });
    const { controls } = await renderWith('/onboarding/first-video', freshMac(), {
      'system.downloads': { error: TimeoutError({ ms: 5000 }), times: 1, answer: stopped },
    });
    await thinking(controls);
    // Nobody pressed Try again: it read again by itself.
    await waitFor(() => el('[data-slot=quiet-check][data-need=download]'), { timeout: 4000 });
  });

  it('a part that didn’t download says so in words, with Try again; rows lead with the job', async () => {
    const failed = (value: unknown) => {
      const downloads = value as Downloads;
      return {
        ...downloads,
        state: 'failed',
        components: downloads.components.map((each) =>
          each.id === 'whisper-tiny'
            ? {
                ...each,
                status: 'failed' as const,
                error: {
                  code: 'jobs.download_failed',
                  messageKey: 'errors.jobs.download_failed',
                  retryable: true,
                  params: { component: 'whisper-tiny' },
                },
              }
            : each,
        ),
      };
    };
    const { controls } = await renderWith('/onboarding/first-video', freshMac(), {
      'system.downloads': { answer: failed },
    });
    await thinking(controls);
    // Kaatu's moment says it stopped, as an alert, and See why opens the download's section under it.
    const check = await waitFor(() => el('[data-slot=quiet-check][data-need=download]'));
    expect(within(check).getByRole('alert').textContent).toContain('stopped downloading');
    await act(async () => {
      fireEvent.click(el('[data-action="quiet-check-open"]'));
    });
    await screen.findByRole('region', { name: 'Models for this Mac' });
    const row = await waitFor(() => job('speech'));
    await waitFor(() => expect(row.dataset['state']).toBe('failed'));
    expect(row.textContent).toContain('Didn’t download');
    expect(row.textContent).toMatch(/^Speech/);
    // The parts are there, but second, and never translated.
    expect(row.querySelector('[translate=no]')?.textContent).toContain('Whisper tiny');
    const alert = within(row).getByRole('alert');
    expect(alert.textContent).toContain(
      'Couldn’t download Whisper tiny. Check your internet connection and try again.',
    );
    // Stopped: the one Try again is the download's own, which starts it again.
    expect(within(alert).queryByRole('button')).toBeNull();
    expect(el('[data-action=retry-downloads]').textContent).toBe('Try again');
  });
});
