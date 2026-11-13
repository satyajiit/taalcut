// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// A template's page says where its reel is (REF1): kept on this Mac with its size, or, for a template read before
// REF1, "Get the reel's video and music", which fetches the link again and shows how it goes, then the kept line;
// a failure names its cause with Try again.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeTemplateMediaScenario } from '../src/backend/fake/templates/template-media';
import { GOLDEN_HOUR, MORNING, templateIdOf } from '../src/backend/fake/templates/template-data';
import { renderApp } from './render-app';

const KEPT = 'The reel’s video and music are kept on this Mac';
const GET = 'Get the reel’s video and music';

const open = (plan: typeof GOLDEN_HOUR, scenario?: FakeTemplateMediaScenario, tickMs = 0) =>
  renderApp(`/templates/${templateIdOf(plan)}`, {
    phase2: { library: { tickMs: 0 }, templateMedia: { tickMs, ...(scenario ? { scenario } : {}) } },
  });

const line = () => document.querySelector<HTMLElement>('[data-slot=reel-media]');

describe('a template’s kept reel, on its page', () => {
  it('says the reel’s video and music are kept on this Mac, with the size', async () => {
    await open(GOLDEN_HOUR);
    expect(await screen.findByText(KEPT)).toBeTruthy();
    expect(line()?.dataset['state']).toBe('kept');
    expect(line()?.textContent).toMatch(/\d+(\.\d)?\s?MB/);
    expect(screen.queryByRole('button', { name: GET })).toBeNull();
  });

  it('an older template gets its reel: the button spins, the download shows, then the kept line', async () => {
    await open(MORNING, undefined, 40);
    const get = await screen.findByRole('button', { name: GET });
    fireEvent.click(get);
    expect(await screen.findByRole('button', { name: 'Getting the reel’s video and music' })).toBeTruthy();
    expect(await screen.findByRole('progressbar', { name: 'Downloading the reference' })).toBeTruthy();
    expect(await screen.findByText(KEPT, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: GET })).toBeNull();
  });

  it('a failed download names its cause, and Try again works', async () => {
    await open(MORNING, 'failsOnce');
    fireEvent.click(await screen.findByRole('button', { name: GET }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Couldn’t download that reference video.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(line()?.dataset['state']).toBe('kept'));
  });
});
