// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2-DOWNLOADER round 3: every part on this Mac keeps its verified licence notice in its folder. Settings › Models ›
// Downloads' job rows and Settings › About's Licences list (UX4 set: one list, no longer This Mac's parts) link it: "Licence" opens one part's notice, "Licences" a menu of
// a job's parts; a part not here has no link; a notice that didn't open says why on its row, and the next try opens
// it. The window names the part, never a path (files.openNotice).
import { NotFoundError } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeOnboardingOptions } from '../../src/backend/fake/fake-onboarding';
import { el } from '../onboarding/onboarding-dom';
import { renderWith, type Hold } from '../onboarding/render-with';

const job = (key: string) => el(`[data-slot=models-on-mac] li[data-job="${key}"]`);
const part = (id: string) => el(`li[data-component="${id}"]`);

/** A Mac whose speech and search models aren't here (Whisper tiny, EmbeddingGemma); the rest is. */
const MISSING: FakeOnboardingOptions = { models: 'missing', downloadTickMs: 0 };

async function click(target: HTMLElement) {
  await act(async () => {
    fireEvent.click(target);
  });
}

describe('licence links', () => {
  it('Settings › Models: a job links the licences of its parts that are here', async () => {
    const { controls } = await renderWith('/settings/models/downloads', { phase2b: { onboarding: MISSING } });
    await screen.findByRole('region', { name: 'Models for this Mac' });
    await waitFor(() => job('search'));

    // Search: only ONNX Runtime is here (its EmbeddingGemma isn't), so its one licence opens at once.
    const one = within(job('search')).getByRole('button', { name: 'Licence for ONNX Runtime' });
    // The part's name is the manifest's: named from the link's content, kept out of translation, never an aria-label.
    expect(one.getAttribute('aria-label')).toBeNull();
    expect(one.querySelector('[translate="no"]')?.textContent).toBe('ONNX Runtime');
    await click(one);
    await waitFor(() => expect(controls.onboarding.noticesOpened).toEqual(['onnxruntime']));

    // Speech: four parts here, Whisper tiny not; "Licences" lists the four in the row's order, each with its SPDX id.
    const licences = within(job('speech')).getByRole('button', { name: 'Licences for Speech' });
    expect(licences.textContent).toBe('Licences');
    fireEvent.keyDown(licences, { key: 'Enter' });
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.dataset['component'])).toEqual([
      'whisper-medium-q5-0',
      'whisper-server',
      'whisper-cpp',
      'silero-vad',
    ]);
    expect(items[2]?.textContent).toBe('whisper.cppMIT');
    await click(await screen.findByRole('menuitem', { name: /^Silero VAD/ }));
    await waitFor(() => expect(controls.onboarding.noticesOpened).toEqual(['onnxruntime', 'silero-vad']));
  });

  it('Settings › Models: a notice that didn’t open says why on its row; the next try opens it', async () => {
    const holds: Record<string, Hold> = {
      'files.openNotice': { error: NotFoundError({ entity: 'notice', id: 'onnxruntime' }), times: 1 },
    };
    const { controls } = await renderWith(
      '/settings/models/downloads',
      { phase2b: { onboarding: MISSING } },
      holds,
    );
    await screen.findByRole('region', { name: 'Models for this Mac' });
    const link = await waitFor(() =>
      within(job('search')).getByRole('button', { name: 'Licence for ONNX Runtime' }),
    );
    await click(link);
    const alert = await within(job('search')).findByRole('alert');
    expect(alert.textContent).toBe(
      'That licence notice is no longer here. It may have been moved or deleted.',
    );
    expect(link.dataset['notice']).toBe('error');
    // Not something a retry fixes: no Try again of its own; the link itself is the next try.
    expect(within(alert).queryByRole('button')).toBeNull();
    await click(link);
    await waitFor(() => expect(within(job('search')).queryByRole('alert')).toBeNull());
    expect(link.dataset['notice']).toBeUndefined();
    expect(controls.onboarding.noticesOpened).toEqual(['onnxruntime']);
  });

  it('Settings › Models: nothing is linked before a part is here', async () => {
    await renderWith('/settings/models/downloads', {
      phase2b: { onboarding: { scenario: 'fresh', downloads: 'paused', downloadTickMs: 600_000 } },
    });
    await screen.findByRole('region', { name: 'Models for this Mac' });
    await waitFor(() => job('writing'));
    // Paused part way: the writing model isn't here yet, so its row has nothing to link.
    expect(within(job('writing')).queryByRole('button', { name: /^Licences? for/ })).toBeNull();
  });

  it('Settings › About: each installed part links its licence; one not here doesn’t', async () => {
    const { controls } = await renderWith('/settings/about', { phase2b: { onboarding: MISSING } });
    await screen.findByRole('list', { name: 'Licences' });
    await waitFor(() => part('whisper-cpp'));
    const row = part('whisper-cpp');
    // The part, what it is used for, its SPDX id, then "Licence" (the word shown, then "Licence for whisper.cpp"
    // for screen readers).
    expect(row.textContent).toMatch(/^whisper\.cpp .+Used for .+MIT.*LicenceLicence for whisper\.cpp$/);
    await click(within(row).getByRole('button', { name: 'Licence for whisper.cpp' }));
    await waitFor(() => expect(controls.onboarding.noticesOpened).toEqual(['whisper-cpp']));
    expect(within(part('whisper-tiny')).queryByRole('button', { name: /^Licence/ })).toBeNull();
  });
});
