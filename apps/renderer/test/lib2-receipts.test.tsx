// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type ImportSession } from '@taalcut/core';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWatched } from './settings/spied-backend';

function fixture(status: ImportSession['status']): ImportSession {
  return {
    id: newId<'ImportSession'>(),
    draftId: null,
    method: 'insta360',
    sourceLabel: 'Camera card',
    sourceId: null,
    status,
    stage: 'checking',
    createdAt: 1,
    updatedAt: 1,
    finishedAt: status === 'completed' ? 1 : null,
    safeToDisconnect: false,
    capabilities: { pause: true, resume: true, cancel: true, retryFailed: true, byteResume: false },
    progress: {
      totalItems: 1,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      archivedItems: 1,
      receivedBytes: 400,
      totalBytes: 400,
      bytesPerSecond: null,
      etaSeconds: null,
      currentFile: null,
    },
  };
}
async function receipt(session: ImportSession) {
  await renderWatched(`/library/imports/${session.id}`, {
    namespace: 'imports',
    procedure: 'session',
    answer: () =>
      Promise.resolve({
        session,
        items: [
          {
            itemId: 'capture',
            name: 'VID_0001',
            state: 'archived',
            receivedBytes: 400,
            error: null,
            result: { kind: 'archived', captureId: newId<'CaptureGroup'>(), complete: false },
          },
        ],
      }),
  });
  await screen.findByRole('heading', { name: 'File outcomes' });
}
describe('LIB2 receipts honour lifecycle as well as transport capabilities', () => {
  it('completed archives show saved originals, their missing members and no live transfer controls', async () => {
    await receipt(fixture('completed'));
    expect(screen.getAllByText('Originals saved').length).toBeGreaterThan(0);
    expect(screen.queryByText('Checking the copy')).toBeNull();
    expect(
      screen.getByText('Capture incomplete. Reimport with the missing originals to repair it.'),
    ).toBeTruthy();
    for (const name of ['Pause', 'Resume', 'Cancel import', 'Retry unfinished files'])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open imported clips' })).toBeNull();
    expect(screen.queryByText(/It is safe to disconnect/)).toBeNull();
  });
  it('a paused transfer offers resume and cancel, while a partial receipt offers retry', async () => {
    await receipt(fixture('paused'));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel import' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry unfinished files' })).toBeNull();
  });
  it('partial completion offers retry without resurrecting pause or resume controls', async () => {
    await receipt(fixture('partial'));
    expect(screen.getByRole('button', { name: 'Retry unfinished files' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });
});
