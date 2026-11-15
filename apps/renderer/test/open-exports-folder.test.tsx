// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// FIX-EXPORTNAMES: the exports folder is one press away (the owner, 2026-11-15: "theirs no feature to access or
// locate the exported video. Add option to open the exported folder").
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { toRpcError, NotFoundError } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { renderWatched, type Watch } from './settings/spied-backend';

const OPEN_FOLDER: Watch = { namespace: 'files', procedure: 'openExportsFolder' };

describe('Open exports folder', () => {
  it('is on Exports, with exports listed or none yet, and asks main to open the folder', async () => {
    for (const options of [{}, { make: { empty: true } }]) {
      const { callsTo } = await renderWatched('/renders', OPEN_FOLDER, options);
      fireEvent.click(await screen.findByRole('button', { name: 'Open exports folder' }));
      // The window names no path: main knows the folder.
      await waitFor(() => expect(callsTo(OPEN_FOLDER)).toEqual([undefined]));
      document.body.innerHTML = '';
    }
  });

  it('says why when the folder could not be opened', async () => {
    await renderWatched('/renders', {
      ...OPEN_FOLDER,
      answer: () => Promise.reject(toRpcError(NotFoundError({ entity: 'folder', id: 'exports' }))),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Open exports folder' }));
    expect(await screen.findByText('Couldn’t open the exports folder')).toBeTruthy();
  });
});
