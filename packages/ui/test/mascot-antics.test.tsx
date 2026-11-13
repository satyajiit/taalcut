// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kaatu, type MascotMood } from '../src/index';

const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);
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

/** Every frame shown over `ms`, in steps short enough to catch each in-between. */
function watch(el: () => HTMLElement, ms: number, step = 15): string[] {
  const seen: string[] = [];
  for (let t = 0; t < ms; t += step) {
    act(() => vi.advanceTimersByTime(step));
    const frame = el().dataset.frame ?? '';
    if (seen.at(-1) !== frame) seen.push(frame);
  }
  return seen;
}

const DIRECTION_FRAMES = /^(up-left|up|up-right|left|center|right|down-left|down|down-right)$/;
const point = (clientX: number, clientY: number) =>
  act(() => void window.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY })));

describe('Kaatu, lively', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    finePointer();
    // Even draws: no double blinks, the same antic every run.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const placed = (node: ReactNode) => {
    const view = wrap(node);
    sprite(view.container).getBoundingClientRect = () =>
      ({ left: 400, top: 300, width: 88, height: 88 }) as DOMRect;
    return view;
  };

  it('turns its head through the in-between frames, never in one jump', () => {
    const { container } = placed(<Kaatu spot="hero" />);
    point(20, 344);
    expect(watch(() => sprite(container), 150)).toEqual(['glance-left', 'left']);
    point(1200, 344);
    expect(watch(() => sprite(container), 250)).toEqual(['glance-left', 'center', 'glance-right', 'right']);
  });

  it('blinks wherever it is looking', () => {
    const { container } = placed(<Kaatu spot="hero" />);
    point(20, 344);
    const seen = watch(() => sprite(container), 4500, 20);
    expect(seen).toContain('blink-left');
    expect(sprite(container).dataset.frame).toBe('left');
  });

  it('gets up to an antic while idle, and ends looking out again', () => {
    const { container } = wrap(<Kaatu spot="hero" />);
    const seen = watch(() => sprite(container), 11_000, 50);
    const antics = seen.filter(
      (frame) => !DIRECTION_FRAMES.test(frame) && !/blink|drowsy|glance/.test(frame),
    );
    expect(antics.length).toBeGreaterThan(0);
    expect(sprite(container).dataset.frame).toMatch(DIRECTION_FRAMES);
  });

  it.each<[string, ReactNode]>([
    ['while thinking', <Kaatu key="thinking" spot="hero" mood="thinking" />],
    ['in the working line', <Kaatu key="line" spot="line" breathe={false} />],
  ])('gets up to nothing %s', (_name, node) => {
    const { container } = wrap(node);
    const seen = watch(() => sprite(container), 20_000, 100);
    expect(seen.filter((frame) => /snack|chomp|yawn|wave|curious|bop|cheeky|wink|clap/.test(frame))).toEqual(
      [],
    );
  });

  it('gives a different reaction to each poke, and four quick ones make it dizzy', () => {
    const { container } = wrap(<Kaatu spot="hero" />);
    const reaction = () => sprite(container).dataset.reaction;
    fireEvent.click(sprite(container));
    act(() => vi.advanceTimersByTime(200));
    expect(reaction()).toBe('heart');
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(sprite(container));
    act(() => vi.advanceTimersByTime(200));
    expect(reaction()).toBe('laugh');
    act(() => vi.advanceTimersByTime(2000));
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(sprite(container));
      act(() => vi.advanceTimersByTime(100));
    }
    expect(reaction()).toBe('dizzy');
  });

  it('goes shy when the pointer rests on it', () => {
    const { container } = wrap(<Kaatu spot="hero" />);
    fireEvent.pointerEnter(sprite(container));
    act(() => vi.advanceTimersByTime(900));
    expect(sprite(container).dataset.reaction).toBe('bashful');
  });

  it('nods off into sleep and wakes with a yawn', () => {
    const view = wrap(<Kaatu spot="hero" />);
    const moodTo = (mood: MascotMood) =>
      view.rerender(
        <I18nProvider i18n={i18n}>
          <Kaatu spot="hero" mood={mood} />
        </I18nProvider>,
      );
    moodTo('sleep');
    const dozing = watch(() => sprite(view.container), 2000, 20);
    expect(dozing[0]).toBe('drowsy');
    expect(dozing.at(-1)).toBe('sleepy');
    moodTo('idle');
    const waking = watch(() => sprite(view.container), 1600, 20);
    expect(waking).toContain('yawn');
    expect(waking.at(-1)).toBe('center');
  });

  it('never stops: breathing with nobody about, and asleep too', () => {
    const { container, rerender } = wrap(<Kaatu spot="hero" />);
    const root = () => container.querySelector<HTMLElement>('[data-slot=mascot]')!;
    act(() => vi.advanceTimersByTime(120_000));
    expect(root().dataset.breathing).toBe('true');
    rerender(
      <I18nProvider i18n={i18n}>
        <Kaatu spot="hero" mood="sleep" />
      </I18nProvider>,
    );
    expect(root().dataset.breathing).toBe('true');
  });

  it('keeps getting up to antics, minute after minute', () => {
    const { container } = wrap(<Kaatu spot="hero" />);
    act(() => vi.advanceTimersByTime(5 * 60_000));
    const late = watch(() => sprite(container), 20_000, 50);
    expect(late.some((frame) => !DIRECTION_FRAMES.test(frame) && !/blink|drowsy|glance/.test(frame))).toBe(
      true,
    );
  });

  it('plays an antic on request, for the dev kit', () => {
    const { container } = wrap(<Kaatu spot="hero" perform="action" performKey={1} />);
    expect(sprite(container).dataset.frame).toBe('clapper');
  });
});
