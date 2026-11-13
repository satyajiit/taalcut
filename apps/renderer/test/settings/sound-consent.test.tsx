// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// EAR1-I5: sound sent through vision has a standing consent of its own (`vision.audio`), so Privacy names it apart
// from vision's frames, and revoking it leaves frames allowed.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../render-app';

describe('Settings › Privacy › sound', () => {
  it('names the sound consent apart from the frames one, and revokes it alone', async () => {
    const { controls } = await renderApp('/settings/usage');
    controls.consents.grant({ module: 'vision.audio', providers: ['google'], grantedAt: Date.now() });
    fireEvent.click(await screen.findByRole('link', { name: 'Privacy' }));
    const list = await screen.findByRole(
      'list',
      { name: 'Steps that send files without asking' },
      { timeout: 5000 },
    );
    await within(list).findByText('Hearing your sound');
    expect(within(list).getByText('Seeing your clips')).toBeTruthy();

    fireEvent.click(within(list).getByRole('button', { name: 'Revoke “Hearing your sound”' }));
    await waitFor(() => expect(within(list).queryByText('Hearing your sound')).toBeNull());
    expect(controls.consents.list().map((consent) => consent.module)).toEqual(['vision', 'speech']);
  }, 15_000);
});
