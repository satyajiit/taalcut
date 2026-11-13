// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** UX1-IMPORT: See which lists each failed file and why; reasons come from the error, else from what failed. */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { failureReason, ImportFailedList, type ImportFailedListProps } from '../src/index';

function list(props: Partial<ImportFailedListProps>) {
  render(
    <I18nProvider i18n={i18n}>
      <ImportFailedList files={[]} {...props} />
    </I18nProvider>,
  );
  return screen.getByRole('region', { name: 'Files that need a look' });
}

describe('the failed files list', () => {
  it('lists each file with its reason and counts the rest', () => {
    const region = list({
      files: [
        { id: 'a', kind: 'video', name: 'beach.mp4', reason: 'It may be damaged.' },
        { id: 'b', kind: 'image', name: 'sunset.heic', reason: 'This photo couldn’t be opened.' },
      ],
      more: 3,
    });
    const rows = region.querySelectorAll('[data-slot=import-failed-file]');
    expect([...rows].map((row) => row.textContent)).toEqual([
      'beach.mp4It may be damaged.',
      'sunset.heicThis photo couldn’t be opened.',
    ]);
    expect(region.textContent).toContain('And 3 more files');
  });

  it('shows bones while the reasons load, and the cause with Try again when they could not', () => {
    const loading = list({ loading: true });
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Loading');
    loading.parentElement?.parentElement?.remove();

    const onRetry = vi.fn();
    list({ error: { code: 'core.unknown', messageKey: 'errors.core.unknown', retryable: false }, onRetry });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('a failed file’s reason', () => {
  it('says the file could not be read when a reading stage failed without known words', () => {
    const error = { code: 'media.unreadable', messageKey: 'errors.media.unreadable', retryable: false };
    expect(failureReason(i18n, 'media.normalise', error)).toBe(
      'Taalcut couldn’t read this file. It may be damaged or only partly copied.',
    );
  });

  it('names the step that did not finish when a later stage failed', () => {
    expect(failureReason(i18n, 'vision.shots', undefined)).toBe(
      '“Finding shots” didn’t finish. The clip plays as usual.',
    );
  });

  it('uses the error’s own words when the catalogue has them', () => {
    const error = { code: 'core.unknown', messageKey: 'errors.core.unknown', retryable: false };
    expect(failureReason(i18n, 'media.normalise', error)).not.toContain('Taalcut couldn’t read this file');
  });
});
