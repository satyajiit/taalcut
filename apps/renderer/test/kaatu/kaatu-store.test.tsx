// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX4: Kaatu as a companion. Show Kaatu is on by default and remembered like the interface sounds; first-visit tips
// stay dismissed; the companion reads the app's work: thinking while anything runs, a grin once everything is done,
// a bashful look on a failure (not again within ten seconds).
import { act, renderHook } from '@testing-library/react';
import { HAPPY_MS } from '@taalcut/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkEvent } from '../../src/features/kaatu/companion-events';
import {
  companionWork,
  OOPS_COOLDOWN_MS,
  reportWork,
  resetCompanionWork,
  SETTLE_MS,
} from '../../src/features/kaatu/companion-work';
import {
  KAATU_STORAGE_KEY,
  kaatuShown,
  setShowKaatu,
  useShowKaatu,
} from '../../src/features/kaatu/kaatu-preference';
import { dismissTip, resetTips, TIPS_STORAGE_KEY, useFirstVisitTip } from '../../src/features/kaatu/tips';

describe('Show Kaatu', () => {
  afterEach(() => setShowKaatu(true));

  it('is on by default and remembers off', () => {
    expect(kaatuShown()).toBe(true);
    setShowKaatu(false);
    expect(window.localStorage.getItem(KAATU_STORAGE_KEY)).toBe('off');
    expect(kaatuShown()).toBe(false);
    setShowKaatu(true);
    expect(window.localStorage.getItem(KAATU_STORAGE_KEY)).toBeNull();
  });

  it('follows a change made in another window', () => {
    const { result } = renderHook(() => useShowKaatu());
    expect(result.current[0]).toBe(true);
    act(() => {
      window.localStorage.setItem(KAATU_STORAGE_KEY, 'off');
      window.dispatchEvent(new StorageEvent('storage', { key: KAATU_STORAGE_KEY }));
    });
    expect(result.current[0]).toBe(false);
  });
});

describe('first-visit tips', () => {
  afterEach(() => resetTips());

  it('show until dismissed, and stay dismissed for that page only', () => {
    const chat = renderHook(() => useFirstVisitTip('chat-start'));
    const other = renderHook(() => useFirstVisitTip('library'));
    expect(chat.result.current.shown).toBe(true);
    act(() => chat.result.current.dismiss());
    expect(chat.result.current.shown).toBe(false);
    expect(other.result.current.shown).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(TIPS_STORAGE_KEY) ?? '[]')).toEqual(['chat-start']);
    // A new visit (a new hook) still finds it dismissed.
    expect(renderHook(() => useFirstVisitTip('chat-start')).result.current.shown).toBe(false);
  });

  it('survive a damaged entry, and come back when reset', () => {
    window.localStorage.setItem(TIPS_STORAGE_KEY, '{not json');
    const { result } = renderHook(() => useFirstVisitTip('chat-start'));
    expect(result.current.shown).toBe(true);
    act(() => dismissTip('chat-start'));
    expect(result.current.shown).toBe(false);
    act(() => resetTips());
    expect(result.current.shown).toBe(true);
  });
});

describe('the companion’s work', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCompanionWork();
  });
  afterEach(() => {
    resetCompanionWork();
    vi.useRealTimers();
  });

  it('thinks while anything runs, and grins once everything is done', () => {
    reportWork('job:a', 'running');
    reportWork('job:b', 'running');
    expect(companionWork()).toEqual({ busy: true, pulse: null });
    reportWork('job:a', 'succeeded');
    vi.advanceTimersByTime(SETTLE_MS);
    expect(companionWork()).toEqual({ busy: true, pulse: null });
    reportWork('job:b', 'succeeded');
    vi.advanceTimersByTime(SETTLE_MS);
    expect(companionWork()).toEqual({ busy: false, pulse: 'happy' });
    vi.advanceTimersByTime(HAPPY_MS);
    expect(companionWork()).toEqual({ busy: false, pulse: null });
  });

  it('does not grin when work starts again straight away (indexing, file after file)', () => {
    reportWork('indexing', 'running');
    reportWork('indexing', 'succeeded');
    vi.advanceTimersByTime(SETTLE_MS / 2);
    reportWork('indexing', 'running');
    vi.advanceTimersByTime(SETTLE_MS);
    expect(companionWork()).toEqual({ busy: true, pulse: null });
  });

  it('grins at once for a moment (an export), and looks bashful on a failure, not twice in ten seconds', () => {
    reportWork('render:1', 'succeeded', { moment: true });
    expect(companionWork().pulse).toBe('happy');
    reportWork('job:x', 'running');
    reportWork('job:x', 'failed');
    expect(companionWork()).toEqual({ busy: false, pulse: 'oops' });
    vi.advanceTimersByTime(3000);
    reportWork('job:y', 'running');
    reportWork('job:y', 'failed');
    expect(companionWork().pulse).toBeNull();
    vi.advanceTimersByTime(OOPS_COOLDOWN_MS);
    reportWork('job:z', 'failed');
    expect(companionWork().pulse).toBe('oops');
  });

  it('reads the backend’s events: a job, the models’ download, indexing, an agent’s run', () => {
    readWorkEvent({ type: 'job.stateChanged', payload: { jobId: 'j1', to: 'running' } } as never);
    expect(companionWork().busy).toBe(true);
    readWorkEvent({ type: 'job.stateChanged', payload: { jobId: 'j1', to: 'cancelled' } } as never);
    expect(companionWork().busy).toBe(false);
    // "Ready" again, with nothing seen downloading, isn't news.
    readWorkEvent({ type: 'components.downloads', payload: { state: 'ready' } } as never);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(companionWork().pulse).toBeNull();
    readWorkEvent({
      type: 'library.indexing',
      payload: { paused: false, overall: { active: 1, waiting: 3 } },
    } as never);
    expect(companionWork().busy).toBe(true);
    readWorkEvent({
      type: 'library.indexing',
      payload: { paused: false, overall: { active: 0, waiting: 0 } },
    } as never);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(companionWork()).toEqual({ busy: false, pulse: 'happy' });
    vi.advanceTimersByTime(HAPPY_MS);
    readWorkEvent({ type: 'agent.runStarted', payload: { runId: 'r1' } } as never);
    expect(companionWork().busy).toBe(true);
    readWorkEvent({ type: 'agent.runFinished', payload: { runId: 'r1', status: 'failed' } } as never);
    expect(companionWork()).toEqual({ busy: false, pulse: 'oops' });
  });
});
