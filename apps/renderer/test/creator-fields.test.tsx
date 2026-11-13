// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { I18nProvider } from '@lingui/react';
import type { Style } from '@taalcut/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { seededStyles } from '../src/backend/fake/phase3/styles/style-seed';
import { CreatorFields } from '../src/features/brand/creator-fields';
import type { PatchOf } from '../src/features/brand/use-style-editor';
import { activateLocale, i18n } from '../src/i18n/i18n';

beforeAll(() => activateLocale('en'));

function show() {
  const style: Style = {
    ...seededStyles()[0]!,
    creator: { name: 'Mira', profileLinkUrl: 'https://example.com/one', profileLinkConfirmed: true },
  };
  const commit = vi.fn(async (_field: string, patch: PatchOf) => {
    Object.assign(style, patch(style));
    return true;
  });
  render(
    <I18nProvider i18n={i18n}>
      <CreatorFields editor={{ style, commit }} />
    </I18nProvider>,
  );
  return { style, commit };
}

describe('creator identity fields', () => {
  it('saves via the brand command callback and resets stale destination confirmation', async () => {
    const { style, commit } = show();
    const link = screen.getByRole('textbox', { name: 'Instagram profile destination link' });
    fireEvent.change(link, { target: { value: 'https://example.com/two' } });
    fireEvent.blur(link);
    await waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(style.creator).toMatchObject({
      name: 'Mira',
      profileLinkUrl: 'https://example.com/two',
      profileLinkConfirmed: false,
    });
  });

  it('keeps invalid URLs out of the saved identity', () => {
    const { commit } = show();
    const link = screen.getByRole('textbox', { name: 'YouTube channel link' });
    fireEvent.change(link, { target: { value: 'javascript:alert(1)' } });
    fireEvent.blur(link);
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByText('Use a secure https link.')).toBeTruthy();
  });
});
