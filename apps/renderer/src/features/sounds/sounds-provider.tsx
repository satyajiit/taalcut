// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useEffect, useMemo, type ReactNode } from 'react';
import { useBackend } from '../../backend/backend';
import { SoundContext, type SoundContextValue } from './interface-sounds';
import { createSoundActivity } from './sound-activity';
import { SoundActivityProvider } from './sound-activity-context';
import { interfaceSoundVoice } from './sound-assets';
import { observeSounds } from './sound-observers';
import { createSoundPreference } from './sound-preference';
import { browserSoundEnvironment, createInterfaceSounds } from './sound-runtime';

export function SoundsProvider({ children }: { children: ReactNode }) {
  const backend = useBackend();
  const owned = useMemo(() => {
    const activity = createSoundActivity();
    const preference = createSoundPreference(backend, () => window.localStorage);
    const sounds = createInterfaceSounds({
      preference,
      activity,
      environment: browserSoundEnvironment(document, window),
      voice: interfaceSoundVoice,
    });
    let retryEnabled: boolean | null = null;
    const choose = async (enabled: boolean) => {
      retryEnabled = enabled;
      if (await preference.setEnabled(enabled)) {
        retryEnabled = null;
        if (enabled) sounds.play('editApplied');
      }
    };
    const value: SoundContextValue = {
      preference,
      sounds,
      setEnabled: (enabled) => {
        void choose(enabled);
      },
      retry: () => {
        if (retryEnabled !== null) void choose(retryEnabled);
        else void preference.refresh();
      },
    };
    return { activity, preference, sounds, value };
  }, [backend]);

  useEffect(() => {
    const stop = owned.sounds.start();
    const unobserve = observeSounds(backend, owned.sounds, owned.preference);
    void owned.preference.refresh();
    return () => {
      unobserve();
      stop();
      owned.preference.cancel();
    };
  }, [backend, owned]);

  return (
    <SoundActivityProvider activity={owned.activity}>
      <SoundContext.Provider value={owned.value}>{children}</SoundContext.Provider>
    </SoundActivityProvider>
  );
}
