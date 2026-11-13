// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ConflictError, toRpcError } from '@taalcut/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from './render-app';
import { renderWatched } from './settings/spied-backend';

const card = { id: 'opaque-volume', method: 'camera', label: 'Camera card', available: true, status: null };
describe('LIB2 recovery controls', () => {
  it('eject runs the typed reader-barrier command and announces success only after it returns', async () => {
    const watch = { namespace: 'commands' as const, procedure: 'dispatch' };
    const { callsTo } = await renderWatched('/library/sources', [
      { namespace: 'imports', procedure: 'sources', answer: () => Promise.resolve([card]) },
      watch,
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Eject' }));
    expect(await screen.findByText('Ejected', { exact: false })).toBeTruthy();
    expect(callsTo(watch)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'imports.ejectSource', payload: { sourceId: card.id } }),
      ]),
    );
  });
  it('a refused eject leaves the source connected and exposes its error', async () => {
    await renderWatched('/library/sources', [
      { namespace: 'imports', procedure: 'sources', answer: () => Promise.resolve([card]) },
      {
        namespace: 'commands',
        procedure: 'dispatch',
        answer: () => Promise.reject(toRpcError(ConflictError({ entity: 'source' }))),
      },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Eject' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Ejected', { exact: false })).toBeNull();
    expect(screen.getByText('Camera card')).toBeTruthy();
  });
  it('filtering filenames does not silently narrow a global selection or change its count', async () => {
    await renderApp('/library/import/folder', { phase2: { library: { count: 0 } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose folder…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select all footage' }));
    const summary = await screen.findByRole('complementary', { name: 'Selection summary' });
    await waitFor(() => expect(summary.textContent).toContain('211 selected'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter filenames' }), {
      target: { value: 'DSC_0001' },
    });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(summary.textContent).toContain('211 selected');
  });
});
