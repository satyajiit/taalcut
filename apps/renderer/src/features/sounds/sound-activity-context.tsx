// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { NO_SOUND_ACTIVITY, type SoundActivity } from './sound-activity';

const SoundActivityContext = createContext<SoundActivity>(NO_SOUND_ACTIVITY);

export function SoundActivityProvider({
  activity,
  children,
}: {
  activity: SoundActivity;
  children: ReactNode;
}) {
  return <SoundActivityContext value={activity}>{children}</SoundActivityContext>;
}

export function useSoundActivity(): SoundActivity {
  return useContext(SoundActivityContext);
}

/** The callback changes the audio gate immediately; React rendering can follow later. */
export function usePlaybackActivity(): (playing: boolean) => void {
  const activity = useSoundActivity();
  const setPlaying = useMemo(() => {
    let release: (() => void) | undefined;
    return (playing: boolean) => {
      if (playing) release ??= activity.acquire('playback');
      else {
        release?.();
        release = undefined;
      }
    };
  }, [activity]);
  useEffect(() => () => setPlaying(false), [setPlaying]);
  return setPlaying;
}
