// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// A phone file's Cancel goes when the file stops sending. If it had focus, focus stays in the row instead of falling
// to the page, so Tab carries on from there (found by phone-flow-a11y.spec's Tab walk at the UX4 gate).
import { I18nProvider } from '@lingui/react';
import type { TransferFile } from '@taalcut/core';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TransferFiles } from '../src/features/library/phone/transfers/transfer-files';
import { activateLocale, i18n } from '../src/i18n/i18n';

const file = (state: TransferFile['state']): TransferFile =>
  ({
    id: 'up_1',
    sessionId: 'ts_1',
    deviceId: 'td_1',
    name: 'IMG_5258.MOV',
    sizeBytes: 1000,
    receivedBytes: state === 'uploading' ? 400 : 1000,
    state,
    updatedAt: 1,
  }) as TransferFile;

const view = (state: TransferFile['state']) => (
  <I18nProvider i18n={i18n}>
    <TransferFiles files={[file(state)]} onCancel={async () => undefined} />
  </I18nProvider>
);

describe('a phone file’s row keeps focus', () => {
  it('when its focused Cancel goes, the row has focus', async () => {
    await activateLocale('en');
    const { rerender } = render(view('uploading'));
    screen.getByRole('button', { name: 'Cancel' }).focus();
    act(() => rerender(view('checking')));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[data-slot=transfer-file]'));
  });

  it('leaves focus alone when Cancel didn’t have it', async () => {
    await activateLocale('en');
    const { rerender } = render(view('uploading'));
    act(() => rerender(view('checking')));
    expect(document.activeElement).toBe(document.body);
  });
});
