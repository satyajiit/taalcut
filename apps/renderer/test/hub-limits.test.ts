// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { HubOffline, HubRateLimited } from '@taalcut/core';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearHubLimit,
  noteHubRefusal,
  retryAfterSeconds,
  useHubLimit,
} from '../src/features/templates/hub/hub-limits';

afterEach(() => {
  clearHubLimit();
  vi.useRealTimers();
});

describe('the hub limit the list shows (UX1: rate-limited is visible on the list)', () => {
  it('reads the wait from a rate limit, and nothing from other refusals', () => {
    expect(retryAfterSeconds(HubRateLimited({ retryAfterSeconds: 720 }))).toBe(720);
    expect(retryAfterSeconds(HubRateLimited({ retryAfterSeconds: 0 }))).toBeNull();
    expect(retryAfterSeconds(HubOffline())).toBeNull();
  });

  it('holds from a refused rating until its retry time, keeps the later of two, and ends by itself', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(1_000_000);
    const { result } = renderHook(() => useHubLimit());
    expect(result.current).toBeNull();

    act(() => noteHubRefusal(HubOffline()));
    expect(result.current).toBeNull();

    act(() => noteHubRefusal(HubRateLimited({ retryAfterSeconds: 60 })));
    expect(result.current).toBe(1_060_000);
    // A shorter wait met later doesn't cut the first one short.
    act(() => noteHubRefusal(HubRateLimited({ retryAfterSeconds: 10 })));
    expect(result.current).toBe(1_060_000);

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBeNull();
  });
});
