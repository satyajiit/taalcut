// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { fireEvent } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { moreFixture, mountGallery, tile } from './more-support';

beforeEach(() => {
  // This file's person asked the Mac for less motion (setup.ts answers "no" to every media query). The answer
  // is read once for the whole file, which is why the sheet's rise is checked in more-gallery.test.tsx.
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query.includes('prefers-reduced-motion'),
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
});

it('under reduced motion a More sheet only fades in: nothing moves', () => {
  mountGallery(moreFixture());
  fireEvent.click(tile('speed'));
  const body = document.querySelector<HTMLElement>('[data-slot=more-sheet] > div');
  expect(body?.style.opacity).toBe('0');
  expect(body?.style.transform ?? '').not.toContain('translate');
});
