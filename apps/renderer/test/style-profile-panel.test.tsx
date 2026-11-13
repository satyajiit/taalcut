// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeStyleProfileScenario } from '../src/backend/fake/templates/fake-style-profiles';
import { renderApp } from './render-app';

const signedIn = () => ({ signedIn: true, username: 'mira.cuts', acknowledgedAt: 1_760_000_000_000 });

const open = (collection: string, scenario?: FakeStyleProfileScenario) =>
  renderApp(`/templates/saved?collection=${collection}`, {
    phase2: { readInstagramAuth: signedIn, ...(scenario ? { styleProfiles: { scenario } } : {}) },
  });

const section = async () => screen.findByRole('region', { name: 'What your saved reels have in common' });

describe('the Saved collection’s style profile (LRN1-STY)', () => {
  it('measures the collection’s templates and names where the summary was written', async () => {
    const { router } = await open('col_inspo');
    const found = await section();
    expect(within(found).getByText('Measured from 3 templates')).toBeTruthy();
    const rows = found.querySelectorAll('[data-slot="style-profile-exemplar"]');
    expect([...rows].map((row) => row.querySelector('[translate="no"]')?.textContent)).toEqual([
      'Golden hour market',
      'Slow morning routine',
      'Three-hook vlog opener',
    ]);
    expect(found.querySelector('[data-written="local"]')?.textContent).toContain(
      'Written on this Mac by qwen3.5-4b',
    );

    fireEvent.click(within(found).getByRole('button', { name: /^Slow morning routine/ }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/templates\/01K7C5M6Q8/));
  });

  it('is honest with no model, and still is after Try again', async () => {
    await open('col_inspo', 'noModel');
    const found = await section();
    expect(found.querySelector('[data-summary="no_model"]')).toBeTruthy();
    fireEvent.click(within(found).getByRole('button', { name: 'Try again' }));
    expect(await within(found).findByRole('status')).toBeTruthy();
    await waitFor(() => expect(found.querySelector('[data-summary="no_model"]')).toBeTruthy(), {
      timeout: 3000,
    });
  });

  it('writes the summary on Try again once the model is ready', async () => {
    await open('col_inspo', 'notYet');
    const found = await section();
    fireEvent.click(within(found).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(found.querySelector('[data-written="local"]')).toBeTruthy(), {
      timeout: 3000,
    });
  });

  it('says what fills a collection with nothing broken down', async () => {
    await open('col_hooks');
    const found = await section();
    expect(found.querySelector('[data-slot="style-profile-empty"]')?.textContent).toContain(
      'Turn a few of these Reels into templates',
    );
  });

  it('holds the summary’s shape while it loads, announced once', async () => {
    await open('col_inspo', 'slow');
    await waitFor(() => expect(document.querySelector('[data-slot="style-profile-bones"]')).toBeTruthy());
    const bones = document.querySelector<HTMLElement>('[data-slot="style-profile-bones"]');
    if (!bones) throw new Error('the bones went away before the slow read answered');
    // Eight facts and three exemplar rows, as the summary lays them out.
    expect(bones.querySelectorAll('.grid > span')).toHaveLength(11);
    expect(within(bones).getByRole('status').textContent).toBe('Loading');
    expect(screen.queryByRole('region', { name: 'What your saved reels have in common' })).toBeNull();
  });

  it('shows a failed read with Try again', async () => {
    await open('col_inspo', 'failing');
    await waitFor(() => expect(document.querySelector('[data-slot="style-profile-error"]')).toBeTruthy());
    expect(screen.getAllByRole('button', { name: /Try again/ }).length).toBeGreaterThan(0);
  });
});
