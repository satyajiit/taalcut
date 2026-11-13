// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { SoundActivity } from './sound-activity';
import type { SoundPreference } from './sound-preference';
import { createSoundPlayer, type SoundName, type SoundVoice } from './sound-player';

export interface SoundEnvironment {
  available(): boolean;
  subscribe(stop: () => void): () => void;
}

export function browserSoundEnvironment(document: Document, window: Window): SoundEnvironment {
  return {
    available: () =>
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      !Array.from(document.querySelectorAll('audio,video')).some((node) => {
        const media = node as HTMLMediaElement;
        return !media.paused && !media.ended && !media.error;
      }),
    subscribe(stop) {
      const hidden = () => {
        if (document.visibilityState !== 'visible') stop();
      };
      document.addEventListener('play', stop, true);
      document.addEventListener('visibilitychange', hidden);
      window.addEventListener('blur', stop);
      return () => {
        document.removeEventListener('play', stop, true);
        document.removeEventListener('visibilitychange', hidden);
        window.removeEventListener('blur', stop);
      };
    },
  };
}

export interface InterfaceSounds {
  play(name: SoundName, identity?: string): void;
  start(): () => void;
}

export function createInterfaceSounds(options: {
  preference: SoundPreference;
  activity: SoundActivity;
  environment: SoundEnvironment;
  voice: (name: SoundName) => SoundVoice | null;
}): InterfaceSounds {
  const { preference, activity, environment } = options;
  let active = false;
  const enabled = () => {
    const state = preference.getSnapshot();
    return active && state.ready && state.enabled && !activity.isBusy() && environment.available();
  };
  const player = createSoundPlayer({ voice: options.voice, enabled });
  const seen = new Set<string>();
  return {
    play(name, identity) {
      // Remember even a suppressed event: focus changes must not replay completed work.
      if (identity) {
        if (seen.has(identity)) return;
        seen.add(identity);
        if (seen.size > 512) seen.delete(seen.values().next().value!);
      }
      player.play(name);
    },
    start() {
      active = true;
      const changed = () => {
        if (!enabled()) player.stopAll();
        else player.preload();
      };
      const subscriptions = [
        preference.subscribe(changed),
        activity.subscribe(changed),
        environment.subscribe(() => player.stopAll()),
      ];
      changed();
      return () => {
        active = false;
        subscriptions.forEach((stop) => stop());
        player.stopAll();
      };
    },
  };
}
