// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { SocialMetadataPack } from '@taalcut/core';
import { afterEach, expect, it, vi } from 'vitest';
import { PublishSocialMeta } from '../src/cards/publish-social-meta';

const social: SocialMetadataPack = {
  researchSummary: [],
  youtube: {
    title: 'The Cut',
    titleAlternates: [],
    description: 'Behind the cut.',
    tags: ['film'],
    chapters: [],
  },
  instagram: { hookLine: 'The Cut', caption: 'Behind the cut.', hashtags: [] },
  tiktok: { caption: 'Behind the cut.', seoKeywords: [], hashtags: [] },
};
const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

function setup(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  render(
    <I18nProvider i18n={i18n}>
      <PublishSocialMeta social={social} selectedYtTitle="The Cut" onSelectYtTitle={() => undefined} />
    </I18nProvider>,
  );
  return screen.getByRole('button', { name: 'Copy YouTube title' });
}

it.each(['missing', 'rejected'])('does not claim clipboard success when access is %s', async (mode) => {
  const button = setup(
    mode === 'missing' ? undefined : { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  );
  await act(async () => fireEvent.click(button));
  expect(button.textContent).toBe('Copy');
  expect(screen.queryByText('Copied')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Could not copy');
});

it('shows confirmation only after the clipboard accepts the text and clears an earlier failure', async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
  const button = setup({ writeText });
  await act(async () => fireEvent.click(button));
  expect(screen.getByRole('alert')).toBeTruthy();
  await act(async () => fireEvent.click(button));
  expect(writeText).toHaveBeenLastCalledWith('The Cut');
  expect(button.textContent).toBe('Copied');
  expect(screen.queryByRole('alert')).toBeNull();
});
