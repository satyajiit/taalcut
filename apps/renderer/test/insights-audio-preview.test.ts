// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canPreviewTrack, useAudioPreview } from '../src/features/insights/audio-preview';
import type { EditsAudioTrack } from '../src/features/make/edits-pulse-model';
import { soundActivityHarness } from './sounds/activity-harness';

const track: EditsAudioTrack = {
  id: 'supplied-track',
  title: 'Supplied song',
  artistName: '',
  audioAssetId: 'audio-id',
  durationSeconds: 10,
  highlights: [],
  isLicensedMusic: false,
  isRoyaltyFree: false,
  isExplicit: false,
  isSaved: false,
};

class AudioStub {
  static instances: AudioStub[] = [];
  currentTime = 0;
  duration = 10;
  onloadedmetadata?: () => void;
  ontimeupdate?: () => void;
  onended?: () => void;
  onerror?: () => void;
  resolve: () => void = () => {};
  reject: (error: Error) => void = () => {};
  play = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      }),
  );
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  constructor(readonly src: string) {
    AudioStub.instances.push(this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  AudioStub.instances = [];
});

describe('Insights supplied audio previews', () => {
  it('does not synthesize audio or claim remote metadata is playable under the app CSP', () => {
    const audio = vi.fn();
    vi.stubGlobal('Audio', audio);
    const { result } = renderHook(useAudioPreview);
    expect(canPreviewTrack(track)).toBe(false);
    expect(canPreviewTrack({ ...track, previewUrl: 'https://music.example/song.mp3' })).toBe(false);
    expect(canPreviewTrack({ ...track, previewUrl: 'app://untrusted/song.mp3' })).toBe(false);
    act(() => result.current.toggleTrack({ ...track, previewUrl: 'https://music.example/song.mp3' }));
    expect(audio).not.toHaveBeenCalled();
    expect(result.current.playingTrackId).toBeNull();
  });

  it('uses actual playback events for a supported supplied media route and releases it on unmount', async () => {
    vi.stubGlobal('Audio', AudioStub);
    const playable = { ...track, hasPreview: true, previewUrl: 'app://media/actual-preview.mp3' };
    const { activity, wrapper } = soundActivityHarness();
    const { result, unmount } = renderHook(useAudioPreview, { wrapper });
    act(() => result.current.toggleTrack(playable, 3));
    expect(activity.isBusy()).toBe(true);
    const audio = AudioStub.instances[0]!;
    expect(audio.src).toBe(playable.previewUrl);
    expect(result.current.playingTrackId).toBeNull();
    await act(async () => {
      audio.onloadedmetadata?.();
      audio.resolve();
    });
    expect(audio.currentTime).toBe(3);
    expect(result.current.playingTrackId).toBe(track.id);
    act(() => {
      audio.currentTime = 4.25;
      audio.ontimeupdate?.();
    });
    expect(result.current.elapsedSeconds).toBe(4.25);
    unmount();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(activity.isBusy()).toBe(false);
  });

  it('ignores a late old player failure and exposes a current playback failure', async () => {
    vi.stubGlobal('Audio', AudioStub);
    const { activity, wrapper } = soundActivityHarness();
    const { result } = renderHook(useAudioPreview, { wrapper });
    act(() => result.current.toggleTrack({ ...track, previewUrl: 'app://media/a.mp3' }));
    const old = AudioStub.instances[0]!;
    act(() => result.current.toggleTrack({ ...track, id: 'new', previewUrl: 'app://media/b.mp3' }));
    const current = AudioStub.instances[1]!;
    await act(async () => {
      old.reject(new Error('late'));
      current.resolve();
    });
    expect(result.current.playingTrackId).toBe('new');
    expect(result.current.errorTrackId).toBeNull();
    expect(activity.isBusy()).toBe(true);
    act(() => current.onerror?.());
    expect(result.current.playingTrackId).toBeNull();
    expect(result.current.errorTrackId).toBe('new');
    expect(activity.isBusy()).toBe(false);
  });

  it('treats remote preview metadata as unavailable without a playback timer or suppression token', async () => {
    const { activity, wrapper } = soundActivityHarness();
    const audio = vi.fn();
    vi.stubGlobal('Audio', audio);
    const timer = vi.spyOn(globalThis, 'setInterval');
    const { result, unmount } = renderHook(useAudioPreview, { wrapper });
    const remoteTrack = { ...track, hasPreview: true };
    expect(canPreviewTrack(remoteTrack)).toBe(false);
    await act(async () => result.current.toggleTrack(remoteTrack));
    expect(audio).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    expect(result.current.playingTrackId).toBeNull();
    expect(result.current.errorTrackId).toBeNull();
    expect(activity.isBusy()).toBe(false);
    unmount();
    timer.mockRestore();
    expect(activity.isBusy()).toBe(false);
  });

  it('pauses a local preview whose play promise resolves after the route has closed', async () => {
    vi.stubGlobal('Audio', AudioStub);
    const { activity, wrapper } = soundActivityHarness();
    const { result, unmount } = renderHook(useAudioPreview, { wrapper });
    act(() => result.current.toggleTrack({ ...track, previewUrl: 'app://media/late.mp3' }));
    const audio = AudioStub.instances[0]!;
    unmount();
    expect(activity.isBusy()).toBe(false);
    await act(async () => audio.resolve());
    expect(audio.pause).toHaveBeenCalledTimes(2);
    expect(activity.isBusy()).toBe(false);
  });
});
