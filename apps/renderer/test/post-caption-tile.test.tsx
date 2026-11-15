// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1 on MORE1's gallery: the Post caption tile says whether the video has a caption, opens the caption dialog,
 * and mounts that dialog only while it is open.
 */
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BackendProvider } from '../src/backend/backend';
import { PostCaptionTile } from '../src/features/timeline/post-caption/post-caption-tile';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { captionFake, TIMELINE } from './post-caption-support';

describe('the Post caption tile (CAP1)', () => {
  it('says there is no caption yet, and opens the caption dialog', async () => {
    await activateLocale('en', 'mac');
    const fake = captionFake();
    render(
      <I18nProvider i18n={i18n}>
        <BackendProvider backend={fake.client}>
          <PostCaptionTile timeline={fake.controls.make.timelines.get(TIMELINE)!} />
        </BackendProvider>
      </I18nProvider>,
    );
    const tile = document.querySelector('[data-tile="caption"]') as HTMLButtonElement;
    expect(tile.textContent).toContain('Post caption');
    expect(tile.textContent).toContain('Not written yet');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(tile);
    expect(await screen.findByRole('dialog', { name: 'Post caption' })).toBeTruthy();
  });

  it('names the platform and who wrote a saved caption', async () => {
    await activateLocale('en', 'mac');
    const fake = captionFake();
    const timeline = {
      ...fake.controls.make.timelines.get(TIMELINE)!,
      postCaptions: [{ platform: 'instagram' as const, text: 'A caption', writtenBy: 'ai' as const }],
    };
    render(
      <I18nProvider i18n={i18n}>
        <BackendProvider backend={fake.client}>
          <PostCaptionTile timeline={timeline} />
        </BackendProvider>
      </I18nProvider>,
    );
    expect(document.querySelector('[data-tile="caption"]')?.textContent).toContain(
      'Instagram, written by Taalcut',
    );
  });
});
