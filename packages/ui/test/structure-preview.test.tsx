// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructurePreview } from '../src/index';
import { STRUCTURE } from './hub-structure-fixture';

type Observed = (entries: { isIntersecting: boolean }[]) => void;
let observed: Observed[] = [];

class FakeIntersectionObserver {
  constructor(callback: Observed) {
    observed.push(callback);
  }
  observe() {}
  disconnect() {}
}

const wrap = (playing: boolean, mode: 'frame' | 'strip' = 'frame') =>
  render(
    <I18nProvider i18n={i18n}>
      <StructurePreview mode={mode} structure={STRUCTURE} playing={playing} label="Golden hour" />
    </I18nProvider>,
  );

const current = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot=structure-preview]')?.dataset.currentSlot;

describe('StructurePreview (U6)', () => {
  beforeEach(() => {
    observed = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout'],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('draws no img, video or URL: only blocks, words and tokens', () => {
    const { container } = wrap(true);
    expect(container.querySelectorAll('img, video, picture, source, iframe, canvas')).toHaveLength(0);
    // The icons' SVG namespace is a name, not an address: everything else must be free of them.
    const html = container.innerHTML.replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
    expect(html.match(/https?:|url\(|data:|blob:|src=|href=/gi)).toBeNull();
    expect(container.querySelector('[data-overlay-role=title]')?.textContent).toBe('Title');
  });

  it('cuts land on the slot starts on a fake clock', () => {
    const { container } = wrap(true);
    expect(current(container)).toBe('0');
    act(() => vi.advanceTimersByTime(450));
    expect(current(container)).toBe('0');
    act(() => vi.advanceTimersByTime(100));
    expect(current(container)).toBe('1');
    expect(container.querySelector('[data-frame-slot]')?.getAttribute('data-frame-slot')).toBe('1');
    act(() => vi.advanceTimersByTime(500));
    expect(current(container)).toBe('2');
    // It goes round: 1.5 s in, slot 1 again.
    act(() => vi.advanceTimersByTime(500));
    expect(current(container)).toBe('0');
  });

  it('pauses off screen and goes on when it is back', () => {
    const { container } = wrap(true);
    act(() => observed.forEach((callback) => callback([{ isIntersecting: false }])));
    act(() => vi.advanceTimersByTime(800));
    expect(current(container)).toBe('0');
    act(() => observed.forEach((callback) => callback([{ isIntersecting: true }])));
    act(() => vi.advanceTimersByTime(600));
    expect(current(container)).toBe('1');
  });

  it('stays still unless playing; a strip plays its first 3 s while the pointer is on it', () => {
    const still = wrap(false);
    act(() => vi.advanceTimersByTime(800));
    expect(current(still.container)).toBe('0');
    still.unmount();
    const strip = wrap(false, 'strip');
    const picture = strip.container.querySelector('[role=img]');
    if (!picture) throw new Error('no picture');
    fireEvent.pointerEnter(picture);
    act(() => vi.advanceTimersByTime(600));
    expect(current(strip.container)).toBe('1');
    expect(strip.container.querySelector('[data-slot=structure-playhead]')).not.toBeNull();
    fireEvent.pointerLeave(picture);
    expect(current(strip.container)).toBe('0');
  });

  it('names itself with a summary and lists the slots as text under Describe slots', () => {
    wrap(true);
    expect(screen.getByRole('img', { name: 'Golden hour: 3 slots, 1.5s, cuts on the beat' })).toBeTruthy();
    expect(screen.getByText('Describe slots')).toBeTruthy();
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items[0]).toContain('Slot 1, 0s to 0.5s: Hook, Close-up, Push in');
    expect(items[1]).toContain('Wide shot of the beach');
    const words = screen.getByText('Wide shot of the beach');
    expect(words.getAttribute('translate')).toBe('no');
  });
});
