// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1 (W2-6): a clip that isn't plainly ready says why on its frame in words, still (no spinner per tile); a
// picture that won't load leaves the frame's grey with a still "no picture" mark instead of a broken image.
import { act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWith } from './onboarding/render-with';

const CHIP_WORDS = [
  'Can’t open this file',
  'Drive not connected',
  'Waits for a model',
  'Searchable',
  'Analysing',
  'Smaller copy',
];
const broken = {
  derived: () => 'taalcut-test:missing.jpg',
  templateAsset: () => null,
  preview: () => null,
  playback: () => null,
  templateReel: () => null,
};

describe('library › clip tiles', () => {
  it('chips say why in words and stand still; a picture that won’t load shows the no-picture mark', async () => {
    await renderWith('/library', { phase2: { library: { count: 300, tickMs: 0 } } }, {}, { media: broken });
    const image = await waitFor(() => {
      const found = document.querySelector('[data-slot=clip-tile] img');
      if (!found) throw new Error('no tile picture yet');
      return found;
    });
    const chips = [...document.querySelectorAll('[data-slot=clip-status]')];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(CHIP_WORDS).toContain(chip.textContent);
      expect(chip.querySelector('.animate-spin')).toBeNull();
    }
    const tile = image.closest('[data-slot=clip-tile]');
    await act(async () => {
      fireEvent.error(image);
    });
    expect(tile?.querySelector('img')).toBeNull();
    expect(tile?.querySelector('[data-slot=no-picture]')).not.toBeNull();
  });
});
