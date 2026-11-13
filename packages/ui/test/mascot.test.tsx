// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kaatu, MascotPreview, type MascotMood } from '../src/index';

const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

/** The vendored sprite element inside Kaatu: it carries the mood, the head turn and the face. */
const sprite = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot=mascot-breath] > span')!;

/** A matchMedia where only the pointer query matches: a Mac with a mouse, no reduced motion. */
function finePointer() {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query.includes('pointer: fine'),
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

describe('Kaatu', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is decorative unless named, and never a control', () => {
    const { container, unmount } = wrap(<Kaatu spot="hero" />);
    expect(sprite(container).getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    unmount();

    wrap(<Kaatu spot="about" labelled />);
    expect(screen.getByRole('img', { name: 'Kaatu, Taalcut’s beaver' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('takes the size of its place', () => {
    const { container } = wrap(<Kaatu spot="line" />);
    const root = container.querySelector<HTMLElement>('[data-slot=mascot]')!;
    expect(root.dataset.spot).toBe('line');
    expect(root.style.width).toBe('32px');
    expect(sprite(container).style.width).toBe('32px');
  });

  it.each<[MascotMood, string | undefined]>([
    ['idle', undefined],
    ['happy', 'delighted'],
    ['oops', 'bashful'],
    ['sleep', 'sleepy'],
  ])('shows the %s face', (mood, face) => {
    const { container } = wrap(<Kaatu spot="hero" mood={mood} />);
    expect(sprite(container).dataset.mood).toBe(mood);
    expect(sprite(container).dataset.reaction).toBe(face);
  });

  it('looks up, nibbles, looks up the other way and nibbles again while thinking, a beat a second', () => {
    const { container } = wrap(<Kaatu spot="line" mood="thinking" breathe={false} />);
    const beat = () => sprite(container).dataset.reaction ?? sprite(container).dataset.direction;
    // Each beat turns through an in-between first, so read it once the turn has landed.
    act(() => vi.advanceTimersByTime(100));
    const beats = [beat()];
    for (let i = 0; i < 4; i += 1) {
      act(() => vi.advanceTimersByTime(900));
      act(() => vi.advanceTimersByTime(100));
      beats.push(beat());
    }
    expect(beats).toEqual(['up-left', 'nibble', 'up-right', 'nibble', 'up-left']);
  });

  it('reacts to a poke, then settles back', () => {
    const { container } = wrap(<Kaatu spot="hero" />);
    fireEvent.click(sprite(container));
    expect(sprite(container).dataset.reaction).toBe('content');
    act(() => vi.advanceTimersByTime(120));
    expect(sprite(container).dataset.reaction).toBe('heart');
    act(() => vi.advanceTimersByTime(800));
    expect(sprite(container).dataset.reaction).toBeUndefined();
  });

  it('turns its head toward the pointer while idle', () => {
    finePointer();
    const { container } = wrap(<Kaatu spot="hero" />);
    const el = sprite(container);
    el.getBoundingClientRect = () => ({ left: 400, top: 300, width: 88, height: 88 }) as DOMRect;
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 344 }));
    });
    act(() => vi.advanceTimersByTime(200));
    expect(el.dataset.direction).toBe('left');
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 444, clientY: 900 }));
    });
    act(() => vi.advanceTimersByTime(200));
    expect(el.dataset.direction).toBe('down');
  });

  it('blinks now and then while awake, not while asleep', () => {
    const { container, rerender } = wrap(<Kaatu spot="hero" />);
    const seen = new Set<string | undefined>();
    for (let i = 0; i < 200; i += 1) {
      act(() => vi.advanceTimersByTime(70));
      seen.add(sprite(container).dataset.reaction);
    }
    expect(seen.has('blink')).toBe(true);
    rerender(
      <I18nProvider i18n={i18n}>
        <Kaatu spot="hero" mood="sleep" />
      </I18nProvider>,
    );
    act(() => vi.advanceTimersByTime(20_000));
    expect(sprite(container).dataset.reaction).toBe('sleepy');
  });

  it('breathes where it sits still, not in the working line', () => {
    const { container } = wrap(
      <>
        <Kaatu spot="hero" />
        <Kaatu spot="line" breathe={false} />
      </>,
    );
    const [hero, line] = [...container.querySelectorAll<HTMLElement>('[data-slot=mascot]')];
    expect(hero?.dataset.breathing).toBe('true');
    expect(line?.dataset.breathing).toBeUndefined();
  });

  it('previews every mood and every size', () => {
    const { container } = wrap(<MascotPreview />);
    const moods = [...container.querySelectorAll<HTMLElement>('[data-slot=mascot]')].map(
      (m) => m.dataset.mood,
    );
    expect(new Set(moods)).toEqual(new Set(['idle', 'thinking', 'happy', 'oops', 'sleep']));
    expect(screen.getByText('About, 112 px')).toBeTruthy();
  });
});
