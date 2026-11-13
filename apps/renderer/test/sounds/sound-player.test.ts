// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  ACTION_COOLDOWN_MS,
  SOUND_NAMES,
  createSoundPlayer,
  type SoundName,
  type SoundVoice,
} from '../../src/features/sounds/sound-player';

class FakeVoice implements SoundVoice {
  playing = false;
  plays = 0;
  stops = 0;
  constructor(private readonly refuse = false) {}
  play(): Promise<void> {
    this.plays += 1;
    if (this.refuse) return Promise.reject(new Error('NotAllowedError'));
    this.playing = true;
    return Promise.resolve();
  }
  stop(): void {
    this.stops += 1;
    this.playing = false;
  }
}

function setup({ on = true, audio = true, refuse = false } = {}) {
  const voices = new Map<SoundName, FakeVoice>();
  const made: SoundName[] = [];
  const clock = { now: 0, on };
  const player = createSoundPlayer({
    voice: (name) => {
      made.push(name);
      if (!audio) return null;
      const voice = new FakeVoice(refuse);
      voices.set(name, voice);
      return voice;
    },
    enabled: () => clock.on,
    now: () => clock.now,
  });
  const end = async (name: SoundName) => {
    await Promise.resolve();
    const voice = voices.get(name);
    if (voice) voice.playing = false;
  };
  return { player, voices, made, clock, end };
}

describe('the interface sound player', () => {
  it('switched off, plays nothing and makes no voice', () => {
    const { player, made, clock } = setup({ on: false });
    player.preload();
    expect(player.play('importDone')).toBe(false);
    expect(made).toEqual([]);
    clock.on = true;
    expect(player.play('importDone')).toBe(true);
  });

  it('where audio cannot play, every call is a no-op', () => {
    const { player, made } = setup({ audio: false });
    for (const name of SOUND_NAMES) expect(player.play(name)).toBe(false);
    expect(made).toEqual(SOUND_NAMES);
  });

  it('a voice factory unavailable in this browser is harmless', () => {
    const player = createSoundPlayer({
      enabled: () => true,
      voice: () => {
        throw new Error('No audio device');
      },
    });
    expect(player.play('complete')).toBe(false);
  });

  it('preloads each voice once', () => {
    const { player, made } = setup();
    player.preload();
    player.preload();
    player.play('editApplied');
    expect(made).toEqual(SOUND_NAMES);
  });

  it('never overlaps itself or queues a suppressed cue', async () => {
    const { player, voices, clock, end } = setup();
    expect(player.play('editApplied')).toBe(true);
    clock.now += ACTION_COOLDOWN_MS;
    expect(player.play('editApplied')).toBe(false);
    expect(player.play('undo')).toBe(false);
    await end('editApplied');
    expect(voices.get('undo')?.plays).toBe(0);
    expect(player.play('editApplied')).toBe(true);
    expect(voices.get('editApplied')?.plays).toBe(2);
  });

  it('limits all action cues together to one per 250 milliseconds', async () => {
    const { player, clock, end } = setup();
    expect(player.play('editApplied')).toBe(true);
    await end('editApplied');
    clock.now = ACTION_COOLDOWN_MS - 1;
    expect(player.play('undo')).toBe(false);
    clock.now += 1;
    expect(player.play('redo')).toBe(true);
  });

  it('lets a completion preempt an action and protects it from other cues', () => {
    const { player, voices, clock } = setup();
    expect(player.play('promptSent')).toBe(true);
    expect(player.play('draftAssembled')).toBe(true);
    expect(voices.get('promptSent')?.stops).toBe(1);
    expect(voices.get('draftAssembled')?.playing).toBe(true);
    clock.now += ACTION_COOLDOWN_MS;
    expect(player.play('undo')).toBe(false);
    expect(player.play('complete')).toBe(false);
    expect(voices.get('draftAssembled')?.stops).toBe(0);
  });

  it('a refused play is silence, and a later gesture may try again', async () => {
    const { player, voices } = setup({ refuse: true });
    expect(player.play('complete')).toBe(true);
    await Promise.resolve();
    expect(voices.get('complete')?.playing).toBe(false);
    expect(player.play('complete')).toBe(true);
  });

  it('stopAll silences an already playing cue', () => {
    const { player, voices } = setup();
    player.play('complete');
    player.stopAll();
    expect(voices.get('complete')?.playing).toBe(false);
  });

  it('reserves the channel while audio is still waiting to start', () => {
    const voice: SoundVoice = { playing: false, stop() {}, play: () => new Promise(() => {}) };
    const player = createSoundPlayer({ enabled: () => true, voice: () => voice });
    expect(player.play('importDone')).toBe(true);
    expect(player.play('complete')).toBe(false);
  });

  it('a play that resolves after stopAll cannot resurrect audio', async () => {
    let started: (() => void) | undefined;
    const voice = new FakeVoice();
    voice.play = () =>
      new Promise<void>((resolve) => {
        started = () => {
          voice.playing = true;
          resolve();
        };
      });
    const player = createSoundPlayer({ enabled: () => true, voice: () => voice });
    player.play('complete');
    player.stopAll();
    started?.();
    await Promise.resolve();
    expect(voice.playing).toBe(false);
  });

  it('an old play resolving cannot stop a newer play of the same voice', async () => {
    const starts: (() => void)[] = [];
    const voice = new FakeVoice();
    voice.play = () =>
      new Promise<void>((resolve) => {
        starts.push(() => {
          voice.playing = true;
          resolve();
        });
      });
    const player = createSoundPlayer({ enabled: () => true, voice: () => voice });
    player.play('complete');
    player.stopAll();
    player.play('complete');
    starts[0]?.();
    await Promise.resolve();
    expect(voice.playing).toBe(true);
    starts[1]?.();
    await Promise.resolve();
    expect(voice.playing).toBe(true);
  });
});
