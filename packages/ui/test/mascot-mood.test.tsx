// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HAPPY_MS,
  OOPS_MS,
  WorkingLine,
  useIdleMood,
  useRunMood,
  type RunMoodInput,
  type RunPhase,
} from '../src/index';

const run = (id: string, phase: RunPhase): RunMoodInput['latest'] => ({ id, phase });

describe('useRunMood', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const start = (input: RunMoodInput) =>
    renderHook((props: RunMoodInput) => useRunMood(props), { initialProps: input });

  it('shows nothing in a chat that is not working', () => {
    const { result } = start({ busy: false, latest: run('old', 'succeeded') });
    expect(result.current).toEqual({ mood: 'idle', visible: false });
  });

  it('thinks while a message is on its way and while the run goes', () => {
    const { result, rerender } = start({ busy: false, latest: null });
    rerender({ busy: true, latest: null });
    expect(result.current).toEqual({ mood: 'thinking', visible: true });
    rerender({ busy: true, latest: run('r1', 'running') });
    expect(result.current).toEqual({ mood: 'thinking', visible: true });
  });

  it('grins briefly when the run it watched finishes well', () => {
    const { result, rerender } = start({ busy: true, latest: run('r1', 'running') });
    rerender({ busy: false, latest: run('r1', 'succeeded') });
    expect(result.current).toEqual({ mood: 'happy', visible: true });
    act(() => vi.advanceTimersByTime(HAPPY_MS));
    expect(result.current).toEqual({ mood: 'idle', visible: false });
  });

  it('looks bashful, never dizzy, when the run fails', () => {
    const { result, rerender } = start({ busy: true, latest: run('r1', 'running') });
    rerender({ busy: false, latest: run('r1', 'failed') });
    expect(result.current).toEqual({ mood: 'oops', visible: true });
    act(() => vi.advanceTimersByTime(OOPS_MS));
    expect(result.current.visible).toBe(false);
  });

  it('just goes when the run is stopped or waits for an answer', () => {
    for (const phase of ['cancelled', 'paused'] as const) {
      const { result, rerender } = start({ busy: true, latest: run('r1', 'running') });
      rerender({ busy: false, latest: run('r1', phase) });
      expect(result.current).toEqual({ mood: 'idle', visible: false });
    }
  });

  it('thinks again when an answered run carries on, and grins when it ends', () => {
    const { result, rerender } = start({ busy: true, latest: run('r1', 'running') });
    rerender({ busy: false, latest: run('r1', 'paused') });
    rerender({ busy: true, latest: run('r1', 'running') });
    expect(result.current.mood).toBe('thinking');
    rerender({ busy: false, latest: run('r1', 'succeeded') });
    expect(result.current.mood).toBe('happy');
  });

  it('does not grin for an older run when a message fails before a new run starts', () => {
    const { result, rerender } = start({ busy: false, latest: run('old', 'succeeded') });
    rerender({ busy: true, latest: run('old', 'succeeded') });
    rerender({ busy: false, latest: run('old', 'succeeded') });
    expect(result.current).toEqual({ mood: 'idle', visible: false });
  });

  it('hides the grin as soon as a new run starts', () => {
    const { result, rerender } = start({ busy: true, latest: run('r1', 'running') });
    rerender({ busy: false, latest: run('r1', 'succeeded') });
    rerender({ busy: true, latest: run('r1', 'succeeded') });
    expect(result.current.mood).toBe('thinking');
  });
});

describe('useIdleMood', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('falls asleep after a quiet minute and wakes on the next pointer move', () => {
    const { result } = renderHook(() => useIdleMood());
    expect(result.current).toBe('idle');
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe('sleep');
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove'));
    });
    expect(result.current).toBe('idle');
  });

  it('keeps Kaatu awake while someone is using the app', () => {
    const { result } = renderHook(() => useIdleMood({ sleepAfterMs: 5000 }));
    for (let i = 0; i < 5; i += 1) {
      act(() => vi.advanceTimersByTime(3000));
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      });
    }
    expect(result.current).toBe('idle');
  });

  it('opens with a given mood for a moment', () => {
    const { result } = renderHook(() => useIdleMood({ startWith: 'oops', startMs: 1000 }));
    expect(result.current).toBe('oops');
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe('idle');
  });
});

describe('WorkingLine', () => {
  const line = (props: Parameters<typeof WorkingLine>[0]) =>
    render(
      <I18nProvider i18n={i18n}>
        <WorkingLine {...props} />
      </I18nProvider>,
    );

  it('says it is working, once, with Kaatu thinking beside it', () => {
    const { container } = line({ mood: 'thinking', visible: true });
    expect(screen.getByRole('status').textContent).toBe('Working on it…');
    const shown = container.querySelector<HTMLElement>('[data-slot=chat-working]')!;
    expect(shown.getAttribute('aria-hidden')).toBe('true');
    expect(shown.textContent).toBe('Working on it…');
    expect(shown.querySelector<HTMLElement>('[data-slot=mascot]')?.dataset.mood).toBe('thinking');
    expect(shown.querySelector<HTMLElement>('[data-slot=mascot]')?.dataset.breathing).toBeUndefined();
  });

  it('keeps Kaatu but drops the words while the answer streams', () => {
    const { container } = line({ mood: 'thinking', visible: true, quiet: true });
    expect(container.querySelector('[data-slot=chat-working]')?.textContent).toBe('');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('grins without a word: success is silent', () => {
    const { container } = line({ mood: 'happy', visible: true });
    expect(container.querySelector('[data-slot=chat-working]')?.textContent).toBe('');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('is not there when nothing is running', () => {
    const { container } = line({ mood: 'idle', visible: false });
    expect(container.querySelector('[data-slot=chat-working]')).toBeNull();
  });
});
