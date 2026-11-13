// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ThumbnailArchetype } from '@taalcut/core';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CARD_FIXTURES } from '../src/cards/fixtures';
import { ThumbnailSurface, THEME_STYLES } from '../src/cards/publish-thumbnail-canvas';

describe('thumbnail fallback layout', () => {
  const variant = CARD_FIXTURES.publishPack.complete!.thumbnails[0]!;
  function draw(archetype: ThumbnailArchetype, textAlign = variant.textAlign, complete = false) {
    return render(
      <I18nProvider i18n={i18n}>
        <ThumbnailSurface
          variant={{ ...variant, textAlign, ...(complete ? { composition: 'complete' } : {}) }}
          aspect="9:16"
          archetype={archetype}
          theme="golden-hour"
          themeStyle={THEME_STYLES['golden-hour']}
          backdropUrl={null}
          showChannelOnThumb
          channelName="Airport stories"
          channelHandle="@airport"
          avatarUrl={null}
          showSafeZones
          durationBadge="0:12"
        />
      </I18nProvider>,
    );
  }

  it('keeps words and channel inside the central portrait crop with a matching square guide', () => {
    const { container } = draw('editorial-specimen');
    const safe = container.querySelector<HTMLElement>('[data-slot="thumbnail-safe-content"]')!;
    expect(safe.style.top).toBe('25%');
    expect(safe.style.bottom).toBe('25%');
    expect(safe.style.right).toBe('18%');
    expect(safe.querySelector('[data-slot="thumbnail-hook"]')).not.toBeNull();
    expect(safe.querySelector('[data-slot="thumbnail-channel-badge"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="ig-grid-crop-guide"]')?.className).toContain('21.875%');
    expect(
      container
        .querySelector<HTMLElement>('[data-slot="thumbnail-canvas"]')
        ?.style.getPropertyValue('--font-display'),
    ).toContain('Noto Sans Variable');
  });

  it('shows complete generated artwork without duplicate hook, badges or a darkening scrim', () => {
    const { container } = draw('minimal-frame', variant.textAlign, true);
    expect(container.querySelector('[data-slot="thumbnail-safe-content"]')).toBeNull();
    expect(container.querySelector('[data-slot="thumbnail-hook"]')).toBeNull();
    expect(container.querySelector('[data-slot="thumbnail-channel-badge"]')).toBeNull();
    expect(container.querySelector('[data-slot="safe-zones-overlay"]')).not.toBeNull();
  });

  it('puts the stat callout with the headline instead of reusing the corner badge layout', () => {
    const { container } = draw('stat-callout');
    const words = container.querySelector('[data-slot="thumbnail-words"]')!;
    expect(words.firstElementChild?.getAttribute('data-slot')).toBe('thumbnail-stat-badge');
  });

  it('keeps the middle alignment instead of placing it at the bottom', () => {
    const { container } = draw('atmospheric-cinema', 'left');
    const words = container.querySelector('[data-slot="thumbnail-words"]')!;
    expect((words.parentElement as HTMLElement).style.justifyContent).toBe('center');
  });
});
