// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// HFW1: the consent card for the Designer's stills over the person's video says what goes and to whom; no file of
// theirs is named, so no count of files shows.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CardOf } from '@taalcut/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CARD_FIXTURES, CardActionsProvider, CardView } from '../../src/index';

describe('the consent card for stills over the person’s video', () => {
  it('says the graphic’s check shows stills of their video to the provider', () => {
    const pending = CARD_FIXTURES.consent.pending;
    if (!pending) throw new Error('no consent fixture');
    const card: CardOf<'consent'> = {
      ...pending,
      tool: 'workspace.renderOver',
      upload: { modules: ['agent'], providers: ['openai'], files: [] },
    };
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <CardActionsProvider value={{}}>
          <CardView card={card} />
        </CardActionsProvider>
      </I18nProvider>,
    );
    expect(screen.getByText(/Checking this graphic shows stills of your video with it on top to/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/0 files/);
  });
});
