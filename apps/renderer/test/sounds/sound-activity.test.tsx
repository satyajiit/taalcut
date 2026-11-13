// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useClipPlayer } from '../../src/features/library/clip/player/use-clip-player';
import { createSoundActivity } from '../../src/features/sounds/sound-activity';
import { usePlaybackActivity } from '../../src/features/sounds/sound-activity-context';
import { soundActivityHarness } from './activity-harness';

it('keeps sounds suppressed until every independent player and recording has stopped', () => {
  const activity = createSoundActivity();
  const changes: boolean[] = [];
  const unsubscribe = activity.subscribe(() => changes.push(activity.isBusy()));
  const first = activity.acquire('playback');
  const second = activity.acquire('playback');
  const microphone = activity.acquire('recording');
  first();
  first();
  second();
  expect(activity.isBusy()).toBe(true);
  expect(changes).toEqual([true]);
  microphone();
  expect(changes).toEqual([true, false]);
  unsubscribe();
  activity.acquire('playback')();
  expect(changes).toEqual([true, false]);
});

it('changes the gate synchronously and releases an unmounted preview without releasing another one', () => {
  const { activity, wrapper } = soundActivityHarness();
  const first = renderHook(usePlaybackActivity, { wrapper });
  const second = renderHook(usePlaybackActivity, { wrapper });
  first.result.current(true);
  first.result.current(true);
  second.result.current(true);
  first.unmount();
  expect(activity.isBusy()).toBe(true);
  second.result.current(false);
  expect(activity.isBusy()).toBe(false);
  second.result.current(true);
  second.unmount();
  expect(activity.isBusy()).toBe(false);
});

it('suppresses sounds during reverse shuttle even though the native video stays paused', () => {
  const { activity, wrapper } = soundActivityHarness();
  const { result, unmount } = renderHook(() => useClipPlayer(1000, 40, []), { wrapper });
  const video = document.createElement('video');
  video.pause = vi.fn();
  Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_CURRENT_DATA });
  let detach!: void | (() => void);
  act(() => {
    detach = result.current.videoRef(video);
    result.current.seek(500);
    result.current.shuttle(-1);
  });
  expect(video.paused).toBe(true);
  expect(result.current.state.playing).toBe(true);
  expect(activity.isBusy()).toBe(true);
  act(() => result.current.pause());
  expect(activity.isBusy()).toBe(false);
  act(() => result.current.shuttle(-1));
  unmount();
  detach?.();
  expect(activity.isBusy()).toBe(false);
});
