// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSoundActivity } from '../../src/features/sounds/sound-activity';
import {
  browserSoundEnvironment,
  createInterfaceSounds,
  type SoundEnvironment,
} from '../../src/features/sounds/sound-runtime';
import type { SoundPreference, SoundPreferenceSnapshot } from '../../src/features/sounds/sound-preference';
import type { SoundVoice } from '../../src/features/sounds/sound-player';

function preference() {
  let snapshot: SoundPreferenceSnapshot = { enabled: true, ready: true, pending: false, error: null };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<SoundPreferenceSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const store: SoundPreference = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh: async () => {},
    changed: () => {},
    cancel: () => update({ ready: false }),
    setEnabled: async (enabled) => {
      update({ enabled });
      return true;
    },
  };
  return { store, update };
}

function setup(environment?: SoundEnvironment) {
  const pref = preference();
  const activity = createSoundActivity();
  const voice: SoundVoice = { play: vi.fn(async () => {}), stop: vi.fn(), playing: false };
  const sounds = createInterfaceSounds({
    preference: pref.store,
    activity,
    voice: () => voice,
    environment: environment ?? { available: () => true, subscribe: () => () => {} },
  });
  const stop = sounds.start();
  return { sounds, stop, pref, activity, voice };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('root interface sound policy', () => {
  it('stops immediately on mute and never replays a suppressed operation', async () => {
    const { sounds, pref, voice, stop } = setup();
    sounds.play('complete', 'export:one');
    expect(voice.play).toHaveBeenCalledTimes(1);
    pref.update({ enabled: false });
    expect(voice.stop).toHaveBeenCalled();
    sounds.play('complete', 'export:two');
    pref.update({ enabled: true });
    sounds.play('complete', 'export:two');
    await Promise.resolve();
    expect(voice.play).toHaveBeenCalledTimes(1);
    stop();
  });

  it('unknown preferences and overlapping playback/recording tokens silence all cues', () => {
    const { sounds, pref, activity, voice, stop } = setup();
    pref.update({ ready: false });
    sounds.play('complete');
    pref.update({ ready: true });
    const playback = activity.acquire('playback');
    const recording = activity.acquire('recording');
    sounds.play('complete');
    playback();
    sounds.play('complete');
    expect(voice.play).not.toHaveBeenCalled();
    recording();
    sounds.play('complete');
    expect(voice.play).toHaveBeenCalledTimes(1);
    stop();
    sounds.play('complete');
    expect(voice.play).toHaveBeenCalledTimes(1);
  });

  it('stops on blur and a pending play resolving after recording begins stays stopped', async () => {
    let finish!: () => void;
    const pref = preference();
    const activity = createSoundActivity();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const voice: SoundVoice = {
      playing: false,
      play: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
      stop: vi.fn(),
    };
    const sounds = createInterfaceSounds({
      preference: pref.store,
      activity,
      voice: () => voice,
      environment: browserSoundEnvironment(document, window),
    });
    const stop = sounds.start();
    sounds.play('complete');
    window.dispatchEvent(new Event('blur'));
    const release = activity.acquire('recording');
    vi.mocked(voice.stop).mockClear();
    finish();
    await Promise.resolve();
    expect(voice.stop).toHaveBeenCalled();
    release();
    stop();
  });
});

describe('browser media gates', () => {
  it('discards cues while unfocused and does not replay them on focus', () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { sounds, voice, stop } = setup(browserSoundEnvironment(document, window));
    sounds.play('complete', 'export:unfocused');
    expect(voice.play).not.toHaveBeenCalled();
    focus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    sounds.play('complete', 'export:unfocused');
    expect(voice.play).not.toHaveBeenCalled();
    sounds.play('complete', 'export:focused');
    expect(voice.play).toHaveBeenCalledTimes(1);
    stop();
  });

  it('recognizes even muted playback and forgets removed DOM media', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const environment = browserSoundEnvironment(document, window);
    const video = document.createElement('video');
    video.muted = true;
    Object.defineProperty(video, 'paused', { value: false });
    document.body.append(video);
    expect(environment.available()).toBe(false);
    video.remove();
    expect(environment.available()).toBe(true);
  });

  it('stops at DOM playback, blur or hidden visibility, and removes listeners on teardown', () => {
    const environment = browserSoundEnvironment(document, window);
    const stop = vi.fn();
    const unsubscribe = environment.subscribe(stop);
    const video = document.createElement('video');
    document.body.append(video);
    video.dispatchEvent(new Event('play'));
    window.dispatchEvent(new Event('blur'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(stop).toHaveBeenCalledTimes(3);
    unsubscribe();
    window.dispatchEvent(new Event('blur'));
    expect(stop).toHaveBeenCalledTimes(3);
    expect(environment.available()).toBe(false);
  });
});
