// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, renderHook } from '@testing-library/react';
import { newId, ok } from '@taalcut/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNarrationRecorder } from '../src/features/voice/use-narration-recorder';
import { soundActivityHarness } from './sounds/activity-harness';

const mock = vi.hoisted(() => ({
  permission: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  api: { cancel: vi.fn() },
}));
vi.mock('../src/backend/backend', () => ({ useBackend: () => mock.api }));
vi.mock('../src/features/voice/use-voice-capture', () => ({ voiceCaptureApi: () => mock.api }));
vi.mock('../src/features/voice/voice-recorder', () => ({ createVoiceRecorder: () => mock }));
const saved = { captureKey: 'take', durationMs: 1500 };
const stop = vi.fn(async () => ok(saved));
const tick = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
};
const countdown = async () => {
  await tick();
  await tick();
  await tick();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mock.permission.mockResolvedValue(ok('granted'));
  mock.start.mockResolvedValue(ok({ stop, cancel: mock.cancel }));
  mock.api.cancel.mockResolvedValue(ok(null));
  URL.createObjectURL = vi.fn(() => 'blob:take');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.useRealTimers());

it('requests permission only after Record and never opens a denied microphone', async () => {
  mock.permission.mockResolvedValue(ok('denied'));
  const { result } = renderHook(() => useNarrationRecorder(newId<'Project'>()));
  expect(mock.permission).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.start(5000);
  });
  await countdown();
  expect(result.current).toMatchObject({ phase: 'idle', permission: 'denied' });
  expect(mock.start).not.toHaveBeenCalled();
});

it('counts down, saves playback, and discards a take only on Retake', async () => {
  const projectId = newId<'Project'>();
  const { activity, wrapper } = soundActivityHarness();
  const { result } = renderHook(() => useNarrationRecorder(projectId), { wrapper });
  await act(async () => {
    await result.current.start(5000);
  });
  expect(result.current).toMatchObject({ phase: 'countdown', count: 3 });
  expect(mock.start).not.toHaveBeenCalled();
  expect(activity.isBusy()).toBe(true);
  await countdown();
  expect(mock.start).toHaveBeenCalledWith(expect.objectContaining({ projectId, maxSamples: 240000 }));
  expect(result.current.phase).toBe('recording');
  expect(activity.isBusy()).toBe(true);
  await act(async () => {
    await result.current.stop();
  });
  expect(result.current).toMatchObject({ phase: 'ready', take: { ...saved, url: 'blob:take' } });
  expect(activity.isBusy()).toBe(false);
  expect(mock.api.cancel).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.reset();
  });
  expect(mock.api.cancel).toHaveBeenCalledWith({ captureId: 'take' });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:take');
  expect(result.current).toMatchObject({ phase: 'idle', take: null });
});

it('releases countdown suppression when the route closes before the microphone opens', async () => {
  const { activity, wrapper } = soundActivityHarness();
  const projectId = newId<'Project'>();
  const { result, unmount } = renderHook(() => useNarrationRecorder(projectId), { wrapper });
  await act(async () => result.current.start(5000));
  expect(activity.isBusy()).toBe(true);
  unmount();
  expect(activity.isBusy()).toBe(false);
  await countdown();
  expect(mock.start).not.toHaveBeenCalled();
});

it('releases suppression when permission fails before the countdown', async () => {
  const { activity, wrapper } = soundActivityHarness();
  mock.permission.mockImplementation(async () => {
    expect(activity.isBusy()).toBe(true);
    throw new Error('permission failed');
  });
  const { result } = renderHook(() => useNarrationRecorder(newId<'Project'>()), { wrapper });
  await act(async () => result.current.start(5000));
  expect(result.current.phase).toBe('idle');
  expect(activity.isBusy()).toBe(false);
});

it('cancels a microphone that opens after the recorder unmounts', async () => {
  const late = Promise.withResolvers<Awaited<ReturnType<typeof mock.start>>>();
  mock.start.mockReturnValue(late.promise);
  const projectId = newId<'Project'>();
  const { result, unmount } = renderHook(() => useNarrationRecorder(projectId));
  await act(async () => {
    await result.current.start(5000);
  });
  await countdown();
  unmount();
  await act(async () => {
    late.resolve(ok({ stop, cancel: mock.cancel }));
  });
  expect(mock.cancel).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('discards a late saved take after cancellation, without reviving playback', async () => {
  const late = Promise.withResolvers<Awaited<ReturnType<typeof stop>>>();
  stop.mockReturnValueOnce(late.promise);
  const projectId = newId<'Project'>();
  const { result } = renderHook(() => useNarrationRecorder(projectId));
  await act(async () => {
    await result.current.start(5000);
  });
  await countdown();
  let stopping!: Promise<void>;
  act(() => {
    stopping = result.current.stop();
  });
  await act(async () => {
    await result.current.reset();
  });
  await act(async () => {
    late.resolve(ok(saved));
    await stopping;
  });
  expect(mock.api.cancel).toHaveBeenCalledWith({ captureId: 'take' });
  expect(result.current).toMatchObject({ phase: 'idle', take: null });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
