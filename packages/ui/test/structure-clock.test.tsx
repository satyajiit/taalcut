// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, render } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructurePreview } from '../src/index';
import { STRUCTURE } from './hub-structure-fixture';

/** A Web Animation as jsdom lacks one: it records what it was asked and where it was put. */
class FakeAnimation {
  currentTime: number | null = 0;
  playState: 'idle' | 'running' | 'paused' | 'finished' = 'idle';
  constructor(
    readonly target: Element,
    readonly frames: Keyframe[],
    readonly options: KeyframeAnimationOptions,
  ) {}
  play() {
    this.playState = 'running';
  }
  pause() {
    this.playState = 'paused';
  }
  cancel() {
    this.playState = 'idle';
  }
}

let animations: FakeAnimation[] = [];

class StillObserver {
  observe() {}
  disconnect() {}
}

/** The live animation on an element: the last one made for it that wasn't cancelled. */
const liveOn = (element: Element | null) =>
  animations.filter((animation) => animation.target === element && animation.playState !== 'idle').at(-1);

const preview = (playing: boolean, onCommit?: () => void) => (
  <I18nProvider i18n={i18n}>
    <Profiler id="preview" onRender={() => onCommit?.()}>
      <StructurePreview mode="frame" structure={STRUCTURE} playing={playing} label="Golden hour" />
    </Profiler>
  </I18nProvider>
);

describe('StructurePreview’s clock (UX4 B18: no React render per frame)', () => {
  beforeEach(() => {
    animations = [];
    vi.stubGlobal('IntersectionObserver', StillObserver);
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value(this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
        const animation = new FakeAnimation(this, frames, options);
        animations.push(animation);
        return animation;
      },
    });
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  });

  it('renders at the cuts, beats and captions only: a handful of commits for two loops, not one a frame', () => {
    let commits = 0;
    render(preview(true, () => (commits += 1)));
    const settled = commits;
    // Two times round the 1.5 s structure, a frame at a time (each its own act, so each update commits): 180
    // frames at 60 fps were 180 renders before.
    for (let frame = 0; frame < 180; frame += 1) act(() => vi.advanceTimersByTime(1000 / 60));
    // Marks at 0.5 and 1.0 (cuts, beats, the title's end) and the loop's end: three a loop.
    expect(commits - settled).toBeLessThanOrEqual(8);
    expect(commits - settled).toBeGreaterThanOrEqual(4);
  });

  it('runs the playhead and the camera as Web Animations on transform, placed where the clock is', () => {
    const { container } = render(preview(true));
    const playhead = container.querySelector('[data-slot=structure-playhead]');
    const lane = liveOn(playhead);
    expect(lane?.playState).toBe('running');
    expect(lane?.options).toMatchObject({ duration: 1500, iterations: Number.POSITIVE_INFINITY });
    expect(lane?.frames).toEqual([{ transform: 'translateX(-100%)' }, { transform: 'translateX(0%)' }]);

    const block = container.querySelector('[data-frame-slot] > span');
    const camera = liveOn(block);
    expect(camera?.playState).toBe('running');
    expect(camera?.options).toMatchObject({ duration: 500, iterations: 1 });
    expect(camera?.frames).toEqual([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }]);

    // At the cut, the next slot's block gets its own move, from its start.
    act(() => vi.advanceTimersByTime(500));
    const next = liveOn(container.querySelector('[data-frame-slot] > span'));
    expect(next).not.toBe(camera);
    expect(next?.playState).toBe('running');
    expect(next?.currentTime).toBeCloseTo(0, 0);
  });

  it('pauses where it stands and goes on from there: the animations and the cuts stay in step', () => {
    const { container, rerender } = render(preview(true));
    act(() => vi.advanceTimersByTime(700));
    rerender(preview(false));
    const root = container.querySelector<HTMLElement>('[data-slot=structure-preview]');
    expect(root?.dataset.currentSlot).toBe('1');
    // Stopped, the strip's playhead goes (as before); the frame's stays where it stood.
    expect(container.querySelector('[data-slot=structure-playhead]')).toBeNull();
    const lane = liveOn(container.querySelector('[data-slot=frame-playhead]'));
    expect(lane?.playState).toBe('paused');
    expect(lane?.currentTime).toBeCloseTo(700, 0);
    const camera = liveOn(container.querySelector('[data-frame-slot] > span'));
    expect(camera?.playState).toBe('paused');
    expect(camera?.currentTime).toBeCloseTo(200, 0);

    // Paused for a while: nothing moves.
    act(() => vi.advanceTimersByTime(2000));
    expect(root?.dataset.currentSlot).toBe('1');

    rerender(preview(true));
    expect(liveOn(container.querySelector('[data-slot=frame-playhead]'))?.currentTime).toBeCloseTo(700, 0);
    expect(liveOn(container.querySelector('[data-slot=structure-playhead]'))?.currentTime).toBeCloseTo(
      700,
      0,
    );
    act(() => vi.advanceTimersByTime(299));
    expect(root?.dataset.currentSlot).toBe('1');
    act(() => vi.advanceTimersByTime(2));
    expect(root?.dataset.currentSlot).toBe('2');
  });

  it('lights the beat the clock is on, beat by beat', () => {
    const { container } = render(preview(true));
    const lit = () =>
      [...container.querySelectorAll<HTMLElement>('[data-beat]')].findIndex((beat) =>
        beat.className.includes('opacity-100'),
      );
    expect(lit()).toBe(0);
    act(() => vi.advanceTimersByTime(510));
    expect(lit()).toBe(1);
    act(() => vi.advanceTimersByTime(500));
    expect(lit()).toBe(2);
  });
});
