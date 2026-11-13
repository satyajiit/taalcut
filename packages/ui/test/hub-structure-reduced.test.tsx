// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructurePreview } from '../src/index';
import { STRUCTURE } from './hub-structure-fixture';
import { installMatchMedia } from './media';

// Every media query matches, so motion reads "reduce" the first time it asks (and keeps it for the file).
beforeAll(() => installMatchMedia(true));

describe('StructurePreview under reduced motion (U6)', () => {
  beforeEach(() => {
    installMatchMedia(true);
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  });
  afterEach(() => vi.useRealTimers());

  it('is a still of slot 1 and the strip: no playback, no playhead, no camera move', () => {
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <StructurePreview mode="frame" structure={STRUCTURE} playing label="Golden hour" />
      </I18nProvider>,
    );
    act(() => vi.advanceTimersByTime(1200));
    const root = container.querySelector<HTMLElement>('[data-slot=structure-preview]');
    expect(root?.dataset.currentSlot).toBe('0');
    expect(root?.dataset.playing).toBeUndefined();
    expect(container.querySelector('[data-slot=structure-strip]')).not.toBeNull();
    expect(container.querySelector('[data-slot=structure-playhead]')).toBeNull();
    const block = container.querySelector<HTMLElement>('[data-frame-slot] > span');
    expect(block?.style.transform ?? '').toBe('');
  });
});
