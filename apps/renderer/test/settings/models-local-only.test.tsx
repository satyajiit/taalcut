// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B10 (the window's part): with Local only on, the jobs it makes simpler or turns off say so, in words with an
// icon, in Settings › Models and in Privacy; with it off, nothing extra shows.
import { callRpc, MODEL_COMMANDS } from '@taalcut/core';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../render-app';

/** Local only as first run turns it on: the switch, and the Local only profile (models on this Mac). */
async function localOnly(path: string) {
  const app = await renderApp(path, { phase2b: { privacy: { localOnly: true } } });
  await act(async () => {
    await callRpc(
      app.client.commands.dispatch({
        name: MODEL_COMMANDS.setProfile,
        payload: { profileId: 'local-only' },
        source: 'ui',
      }),
    );
  });
  return app;
}

describe('Local-only quality labels', () => {
  it('Models opens with what Local only changes, and each job row carries its label', async () => {
    await localOnly('/settings/models');
    const changes = await screen.findByRole('list', { name: 'What Local only changes' });
    const labels = within(changes)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    // Music has a model on this Mac in the Local only profile, so it isn't listed.
    expect(labels).toEqual([
      'The agent is simpler on this Mac',
      'Descriptions are simpler on this Mac',
      'Voice is off with Local only',
      'Generated images are off with Local only',
    ]);
    // Off is the warning tone; simpler stays neutral.
    expect(
      within(changes).getByText('Voice is off with Local only').closest('[data-quality]'),
    ).toHaveProperty('dataset.quality', 'unavailable');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show jobs' }));
    });
    const agent = screen.getByRole('region', { name: /^Agent/ });
    expect(within(agent).getByText('The agent is simpler on this Mac')).toBeTruthy();
  });

  it('with Local only off, Models shows no labels', async () => {
    await renderApp('/settings/models');
    await screen.findByRole('radiogroup');
    expect(screen.queryByRole('list', { name: 'What Local only changes' })).toBeNull();
    expect(document.querySelector('[data-quality]')).toBeNull();
  });

  it('Privacy labels the simpler jobs beside their names; off jobs keep their own words', async () => {
    await localOnly('/settings/privacy');
    await screen.findByRole('list', { name: 'What each job sends' });
    const row = (module: string) => document.querySelector<HTMLElement>(`li[data-module="${module}"]`);
    await screen.findByText('The agent is simpler on this Mac');
    expect(row('agent')?.textContent).toContain('Runs on this Mac');
    expect(row('images')?.textContent).toContain('Off while Local only is on');
    expect(row('images')?.querySelector('[data-quality]')).toBeNull();
  });
});
