// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kaatu } from '../src/index';
import { installMatchMedia } from './media';

// Every media query matches here, so motion reads "reduce" the first time it asks
// (it remembers the answer for the whole file). Its own file for that reason.
beforeAll(() => installMatchMedia(true));

describe('Kaatu under reduced motion', () => {
  beforeEach(() => {
    installMatchMedia(true);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const wrap = (mood: 'idle' | 'thinking') =>
    render(
      <I18nProvider i18n={i18n}>
        <Kaatu spot="hero" mood={mood} />
      </I18nProvider>,
    );

  it('does not breathe, and a poke changes the face without the squash', () => {
    const { container } = wrap('idle');
    const root = container.querySelector<HTMLElement>('[data-slot=mascot]')!;
    expect(root.dataset.breathing).toBeUndefined();
    // The sprite sits in the breath's span (UX4: the breath runs on the compositor).
    const sprite = root.querySelector<HTMLElement>('[data-slot=mascot-breath] > span')!;
    const squash = sprite.firstElementChild as HTMLElement & { animate: unknown };
    const animate = vi.fn();
    squash.animate = animate;
    fireEvent.click(sprite);
    expect(sprite.dataset.reaction).toBe('heart');
    expect(animate).not.toHaveBeenCalled();
  });

  it('keeps thinking, at half the pace, like a loader', () => {
    const { container } = wrap('thinking');
    const sprite = container.querySelector<HTMLElement>('[data-slot=mascot-breath] > span')!;
    expect(sprite.dataset.direction).toBe('up-left');
    act(() => vi.advanceTimersByTime(1000));
    expect(sprite.dataset.direction).toBe('up-left');
    expect(sprite.dataset.reaction).toBeUndefined();
    act(() => vi.advanceTimersByTime(1000));
    expect(sprite.dataset.reaction).toBe('nibble');
  });
});
