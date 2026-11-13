// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX4: Kaatu as a companion. The breath is a CSS animation on its own span (the compositor's, no style work per
// frame), held under reduced motion; the calm companion doesn't follow the pointer; Show Kaatu off hides every
// decorative Kaatu and keeps About's; a moment is Kaatu and one line, its words carrying the meaning.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kaatu, KaatuMoment, KaatuPresenceProvider, MASCOT_SIZES } from '../src/index';

const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

function media(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query.includes('pointer: fine') || (reduce && query.includes('reduce')),
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  media(false);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Kaatu’s breath', () => {
  it('is a CSS animation on its own span, slower asleep, and the outer element keeps no breath of its own', () => {
    const { container } = wrap(
      <>
        <Kaatu spot="hero" />
        <Kaatu spot="hero" mood="sleep" />
        <Kaatu spot="line" breathe={false} />
      </>,
    );
    const breaths = [...container.querySelectorAll<HTMLElement>('[data-slot=mascot-breath]')];
    expect(breaths.map((b) => b.dataset.breath)).toEqual(['awake', 'asleep', undefined]);
    // The outer element's transform is the lean only (no scaleY keyframes on it).
    const outer = container.querySelector<HTMLElement>('[data-slot=mascot]')!;
    expect(outer.style.transform).not.toMatch(/scaleY/);
  });
});

describe('the companion', () => {
  it('has its own size and does not turn to the pointer', () => {
    expect(MASCOT_SIZES.companion).toBe(40);
    expect(MASCOT_SIZES.moment).toBe(48);
    const { container } = wrap(<Kaatu spot="companion" calm />);
    const sprite = container.querySelector<HTMLElement>('[data-slot=mascot-breath] > span')!;
    const before = sprite.getAttribute('style');
    fireEvent.pointerMove(window, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 4000, clientY: 0 });
    vi.advanceTimersByTime(400);
    expect(sprite.getAttribute('style')).toBe(before);
    expect(sprite.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Show Kaatu', () => {
  it('off: decorative Kaatus go, About’s named one stays, and a moment keeps its words', () => {
    const { container } = wrap(
      <KaatuPresenceProvider value={false}>
        <Kaatu spot="companion" calm />
        <Kaatu spot="about" labelled />
        <KaatuMoment tone="success">Your video is exported.</KaatuMoment>
      </KaatuPresenceProvider>,
    );
    expect(container.querySelectorAll('[data-slot=mascot]')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Kaatu, Taalcut’s beaver' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Your video is exported.');
  });
});

describe('a moment', () => {
  it('reads its line politely, a failure as an alert, and a tip with a dismiss', () => {
    const dismiss = vi.fn();
    wrap(
      <>
        <KaatuMoment tone="wait">Indexing your clips.</KaatuMoment>
        <KaatuMoment tone="failure">The export stopped.</KaatuMoment>
        <KaatuMoment tone="tip" onDismiss={dismiss}>
          A tip.
        </KaatuMoment>
      </>,
    );
    expect(screen.getByRole('status').textContent).toBe('Indexing your clips.');
    expect(screen.getByRole('alert').textContent).toBe('The export stopped.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('thinks while waiting, grins on a success, and leaves Kaatu out when the page has one', () => {
    const { container } = wrap(
      <>
        <KaatuMoment tone="wait">Waiting.</KaatuMoment>
        <KaatuMoment tone="success">Done.</KaatuMoment>
        <KaatuMoment tone="tip" kaatu={false}>
          Words alone.
        </KaatuMoment>
      </>,
    );
    const moods = [...container.querySelectorAll<HTMLElement>('[data-slot=kaatu-moment]')].map(
      (moment) => moment.querySelector<HTMLElement>('[data-slot=mascot]')?.dataset.mood ?? null,
    );
    expect(moods).toEqual(['thinking', 'happy', null]);
  });
});
