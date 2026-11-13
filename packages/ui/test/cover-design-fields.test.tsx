// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CoverDesign } from '@taalcut/core';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CoverDesignFields } from '../src/cards/cover-design-fields';
import { coverFromVariant } from '../src/cards/cover-editor';
import { CARD_FIXTURES } from '../src/cards/fixtures';

describe('persisted authored cover controls', () => {
  it('edits actual text and palette layers while preserving their layout and illustration', () => {
    const design: CoverDesign = {
      version: 1,
      palette: { ink: '#111111', paper: '#eeeeee', accent: '#ed751b', muted: '#888888' },
      layers: [
        {
          kind: 'text',
          text: 'Never\ngets old.',
          fontSize: 0.18,
          font: 'notoSans',
          weight: 700,
          lineHeight: 1.08,
          letterSpacing: -0.02,
          align: 'left',
          color: 'ink',
          opacity: 1,
          rotation: 0,
          box: { x: 0.07, y: 0.19, width: 0.8, height: 0.25 },
        },
        {
          kind: 'shape',
          shape: 'rectangle',
          fill: 'accent',
          stroke: 'transparent',
          strokeWidth: 0,
          radius: 0,
          opacity: 1,
          rotation: 0,
          box: { x: 0.07, y: 0.44, width: 0.5, height: 0.01 },
        },
      ],
    };
    const change = vi.fn();
    const view = render(
      <I18nProvider i18n={i18n}>
        <CoverDesignFields design={design} paused={false} onChange={change} />
      </I18nProvider>,
    );
    fireEvent.change(view.getByLabelText('Text layer 1'), { target: { value: 'Above\nthe clouds.' } });
    expect(change.mock.lastCall?.[0].layers[0]).toEqual({ ...design.layers[0], text: 'Above\nthe clouds.' });
    expect(change.mock.lastCall?.[0].layers[1]).toEqual(design.layers[1]);
    fireEvent.change(view.getByLabelText('Accent'), { target: { value: '#aa4411' } });
    expect(change.mock.lastCall?.[0].palette.accent).toBe('#aa4411');
    expect(change.mock.lastCall?.[0].layers).toEqual(design.layers);
  });

  it('keeps complete generated artwork free of duplicate title, kicker and stat overlays when saved', () => {
    const variant = CARD_FIXTURES.publishPack.complete!.thumbnails[0]!;
    const cover = coverFromVariant({ ...variant, composition: 'complete' });
    expect(cover.source).toEqual({ kind: 'asset', assetId: variant.selectedAssetId });
    expect([cover.hookText, cover.kickerText, cover.statBadge]).toEqual(['', '', '']);
    expect(coverFromVariant(variant).hookText).toBe(variant.hookText);
  });
});
