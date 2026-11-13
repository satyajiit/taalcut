// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { I18nProvider } from '@lingui/react';
import type * as Router from '@tanstack/react-router';
import { newId } from '@taalcut/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { MakeShortButton } from '../src/features/shorts/make-short-button';
import { activateLocale, i18n } from '../src/i18n/i18n';

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof Router>()),
  useNavigate: () => vi.fn(),
}));
beforeAll(() => activateLocale('en'));

function show(
  source?: { kind: 'asset'; assetId: ReturnType<typeof newId<'Asset'>>; name: string },
  localOnly = false,
) {
  const onCreate = vi.fn();
  render(
    <I18nProvider i18n={i18n}>
      <BackendProvider backend={createFakeBackend().client}>
        <MakeShortButton source={source} onCreate={onCreate} localOnly={localOnly} />
      </BackendProvider>
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Make a short' }));
  return onCreate;
}

describe('Make a short entry', () => {
  it('starts one 60-second portrait request with the exact library asset', () => {
    const assetId = newId<'Asset'>();
    const create = show({ kind: 'asset', assetId, name: 'Interview' });
    fireEvent.click(screen.getByRole('button', { name: 'Create short' }));
    expect(create).toHaveBeenCalledOnce();
    const text = create.mock.calls[0]![0] as string;
    expect(text).toContain('one best portrait short');
    expect(text).toContain('60 seconds');
    expect(text).toContain(assetId);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rejects out-of-range custom length and starts the requested valid duration', () => {
    const create = show({ kind: 'asset', assetId: newId<'Asset'>(), name: 'Interview' });
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    const duration = screen.getByRole('spinbutton', { name: 'Length in seconds' });
    fireEvent.change(duration, { target: { value: '180' } });
    expect((screen.getByRole('button', { name: 'Create short' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(duration, { target: { value: '179' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create short' }));
    expect(create.mock.calls[0]![0]).toContain('179 seconds');
  });

  it('requires a valid source and preserves Local only for online imports', () => {
    show(undefined, true);
    expect((screen.getByRole('textbox', { name: 'YouTube video link' }) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Create short' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Choose a video file…' })).toBeTruthy();
  });
});
