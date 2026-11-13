// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, TimeoutError, type PreviewSession } from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewRefresh,
  type PreviewRefreshState,
} from '../src/features/timeline/preview/preview-refresh';

const sessionId = newId<'PreviewSession'>();
const session = (timelineRevision: number, revision = timelineRevision): PreviewSession => ({
  sessionId,
  timelineRevision,
  revision,
  url: `app://preview/token/index.html?rev=${revision}`,
  width: 1080,
  height: 1920,
  rate: { num: 30, den: 1 },
  durationFrames: 300,
  compositionHash: 'a'.repeat(64),
});

function setup() {
  vi.useFakeTimers();
  const builds: ReturnType<typeof Promise.withResolvers<PreviewSession>>[] = [];
  const build = vi.fn(() => {
    const result = Promise.withResolvers<PreviewSession>();
    builds.push(result);
    return result.promise;
  });
  const close = vi.fn(async () => undefined);
  const states: PreviewRefreshState[] = [];
  const refresh = createPreviewRefresh({ open: build, refresh: build, close }, (state) => states.push(state));
  return { refresh, builds, build, close, state: () => states.at(-1)! };
}
afterEach(() => vi.useRealTimers());

describe('preview revision acknowledgement', () => {
  it('coalesces rapid changes behind a single build and waits for the matching paint', async () => {
    const { refresh, builds, build, state } = setup();
    refresh.request(1);
    await vi.advanceTimersByTimeAsync(0);
    refresh.request(2);
    refresh.request(3);
    refresh.request(4);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(build).toHaveBeenCalledTimes(1);
    builds[0]!.resolve(session(1));
    await vi.advanceTimersByTimeAsync(150);
    expect(build).toHaveBeenCalledTimes(2);
    expect(state().displayed).toBeNull();
    builds[1]!.resolve(session(4));
    await vi.advanceTimersByTimeAsync(0);
    refresh.painted(session(1).url);
    expect(state().displayed).toBeNull();
    refresh.painted(session(4).url);
    expect(state()).toMatchObject({ requested: 4, compiled: 4, displayed: 4 });
    refresh.dispose();
  });

  it('retains the last frame and retries a failed refresh without acknowledging it', async () => {
    const { refresh, builds, state } = setup();
    refresh.request(1);
    await vi.advanceTimersByTimeAsync(0);
    builds[0]!.resolve(session(1));
    await vi.advanceTimersByTimeAsync(0);
    refresh.painted(session(1).url);
    refresh.request(2);
    await vi.advanceTimersByTimeAsync(150);
    builds[1]!.reject(TimeoutError({ ms: 500 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toMatchObject({ compiled: 1, displayed: 1, failure: { code: 'core.timeout' } });
    await vi.advanceTimersByTimeAsync(500);
    builds[2]!.resolve(session(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toMatchObject({ compiled: 2, displayed: 1, failure: null });
    refresh.painted(session(2).url);
    expect(state().displayed).toBe(2);
    refresh.dispose();
  });

  it('discards and closes a late opening response after switching timelines', async () => {
    const { refresh, builds, state, close } = setup();
    refresh.request(8);
    await vi.advanceTimersByTimeAsync(0);
    refresh.dispose();
    builds[0]!.resolve(session(8));
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledWith(session(8));
    expect(state().session).toBeNull();
  });

  it('does not confuse the build revision with the timeline revision', async () => {
    const { refresh, builds, state } = setup();
    refresh.request(37);
    await vi.advanceTimersByTimeAsync(0);
    builds[0]!.resolve(session(37, 0));
    await vi.advanceTimersByTimeAsync(0);
    refresh.painted(session(37, 0).url);
    expect(state()).toMatchObject({ compiled: 37, displayed: 37 });
    refresh.dispose();
  });
});
