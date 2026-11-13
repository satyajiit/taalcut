// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2-DOWNLOADER: Settings › Models › Downloads (UX4 set: its own view) shows everything this Mac needs as one download: a row per job with its parts
// after it, a summary of the whole, and what the download can do now. Download fetches what is missing; a part
// that fails says why in the component manager's own words, with Try again; Pause holds it, Resume picks it up,
// Cancel asks first and deletes what has arrived; a disk too full says so with its fix (Open Storage Settings).
import { DOWNLOADS_SHOW_ACTION } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FakeOnboardingOptions } from '../../src/backend/fake/fake-onboarding';
import { el, press } from '../onboarding/onboarding-dom';
import { renderWith } from '../onboarding/render-with';

const GB = 1024 ** 3;

function onMac(onboarding: FakeOnboardingOptions, freeDiskBytes?: number) {
  return renderWith('/settings/models/downloads', {
    phase2b: { onboarding: { downloadTickMs: 0, ...onboarding } },
    ...(freeDiskBytes === undefined ? {} : { phase3: { hardware: { freeDiskBytes } } }),
  });
}

const job = (key: string) => el(`[data-slot=models-on-mac] li[data-job="${key}"]`);
const summary = () => el('[data-slot=models-on-mac] [data-slot=downloads-summary]');
const section = () => screen.findByRole('region', { name: 'Models for this Mac' });

describe('Settings › Models › Models for this Mac', () => {
  it('lists every job this Mac needs, says what is missing, and Download fetches it', async () => {
    await onMac({ models: 'missing' });
    const models = await section();
    await waitFor(() => job('speech'));
    const jobs = [...models.querySelectorAll<HTMLElement>('li[data-job]')].map((row) => row.dataset['job']);
    expect(jobs).toEqual(['speech', 'search', 'text', 'shots', 'beats', 'writing', 'titles', 'sounds']);
    // The job first; its parts after it, as written and never translated.
    expect(job('speech').textContent).toMatch(/^Speech/);
    expect(job('speech').querySelector('[translate=no]')?.textContent).toContain('Whisper tiny');
    expect(job('speech').dataset['state']).toBe('missing');
    // What is left to fetch (Whisper tiny), not the whole job: the rest of Speech is here.
    expect(job('speech').textContent).toMatch(/78\sMB$/);
    expect(job('search').dataset['state']).toBe('missing');
    expect(job('writing').textContent).toContain('Ready');
    expect(summary().textContent).toMatch(/to download\. This Mac has .+ free\./);

    await press('[data-action=download-models]');
    await waitFor(() => expect(summary().dataset['state']).toBe('ready'));
    expect(summary().textContent).toContain('Everything this Mac needs is here');
    expect(job('speech').dataset['state']).toBe('ready');
    expect(within(models).queryByRole('button', { name: /^Download/ })).toBeNull();
  });

  it('before the first byte arrives, the summary says the size, never “0 byte of …”', async () => {
    await onMac({ scenario: 'fresh', downloadTickMs: 600_000 });
    await section();
    await press('[data-action=download-models]');
    await waitFor(() => expect(summary().dataset['state']).toBe('downloading'));
    const line = summary().querySelector('.font-mono');
    expect(line?.textContent).toMatch(/^[\d.]+\sGB$/);
    expect(summary().textContent).not.toMatch(/\b0\sbyte/);
  });

  it('a part that didn’t download says why in plain words, with Try again', async () => {
    await onMac({ models: 'broken' });
    const models = await section();
    await press('[data-action=download-models]');
    await waitFor(() => expect(job('speech').dataset['state']).toBe('failed'));
    const alert = within(job('speech')).getByRole('alert');
    expect(alert.textContent).toContain(
      'The server sent a different file for Whisper tiny. Try again later.',
    );
    expect(alert.textContent).not.toContain('Something went wrong');
    expect(job('speech').textContent).toContain('Didn’t download');
    // The rest installed; the whole says one part is missing, and Try again is the header's one action.
    expect(job('search').dataset['state']).toBe('ready');
    expect(summary().textContent).toContain('1 part didn’t download');
    expect(within(models).queryByRole('button', { name: /^Download/ })).toBeNull();
    // Stopped: Try again is the header's, once; while the rest still downloads it is the row's.
    expect(within(models).getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    expect(el('[data-action=retry-downloads]')).toBeTruthy();
  });

  it('pauses, resumes, and cancels only after asking', async () => {
    await onMac({ scenario: 'fresh', downloads: 'midway', downloadTickMs: 600_000 });
    await section();
    await waitFor(() => expect(summary().dataset['state']).toBe('downloading'));
    expect(job('writing').dataset['state']).toBe('downloading');
    expect(job('beats').textContent).toMatch(/Reconnecting in \d+ s/);

    await press('[data-action=pause-downloads]');
    await waitFor(() => expect(summary().dataset['state']).toBe('paused'));
    expect(job('writing').dataset['state']).toBe('paused');
    expect(within(job('writing')).getByRole('progressbar')).toBeTruthy();

    await press('[data-action=resume-downloads]');
    await waitFor(() => expect(summary().dataset['state']).toBe('downloading'));

    await press('[data-action=ask-cancel-downloads]');
    const ask = screen.getByRole('group', { name: /^Cancel the download\?/ });
    // The safe choice has focus; Escape keeps downloading and gives focus back to Cancel.
    expect(document.activeElement?.textContent).toBe('Keep downloading');
    await act(async () => {
      fireEvent.keyDown(ask, { key: 'Escape' });
    });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-action')).toBe('ask-cancel-downloads'),
    );
    expect(summary().dataset['state']).toBe('downloading');

    await press('[data-action=ask-cancel-downloads]');
    await press('[data-action=cancel-downloads]');
    await waitFor(() => expect(summary().dataset['state']).toBe('missing'));
    expect(job('writing').dataset['state']).toBe('missing');
    expect(el('[data-action=download-models]').textContent).toMatch(/^Download \d/);
  });

  it('a disk too full says so with the sizes and its fix, which opens Storage', async () => {
    const { controls } = await onMac({ models: 'missing' }, 0.2 * GB);
    const actions: string[] = [];
    controls.events.onAny((event) => {
      if (event.type === 'ui.action') actions.push(event.payload.action);
    });
    await section();
    await press('[data-action=download-models]');
    const problems = await waitFor(() => el('[data-slot=downloads-problems]'));
    expect(problems.textContent).toContain('The models this Mac needs don’t fit on its disk.');
    expect(problems.textContent).toMatch(/They need .+ free\. This Mac has .+\./);
    await act(async () => {
      fireEvent.click(within(problems).getByRole('button', { name: 'Open Storage Settings' }));
    });
    await waitFor(() => expect(actions).toContain('system.openStorage'));
  });

  it('main’s “couldn’t download” notification lands on that job’s row, focused, or on the fix for the whole', async () => {
    // jsdom lays nothing out, so it has no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
    const { controls, router } = await onMac({ models: 'missing' }, 0.2 * GB);
    await router.navigate({ to: '/library' });
    // The palette's listener may still be on its way: sent until it lands.
    await waitFor(() => {
      act(() =>
        controls.events.emit('ui.action', { action: DOWNLOADS_SHOW_ACTION, args: { job: 'search' } }),
      );
      // It names Models' download; the download is Models' Downloads view, where it lands.
      expect(router.state.location.pathname).toBe('/settings/models/downloads');
    });
    await waitFor(() => expect(document.activeElement).toBe(job('search')));
    expect(router.state.location.hash).toBe('downloads-search');
    // A job this window doesn't know lands on the whole download; a disk too full puts its fix first.
    await press('[data-action=download-models]');
    await waitFor(() => el('[data-slot=downloads-problems]'));
    act(() => controls.events.emit('ui.action', { action: DOWNLOADS_SHOW_ACTION, args: { job: 'nothing' } }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Open Storage Settings'));
    expect(router.state.location.hash).toBe('downloads');
  });
});
