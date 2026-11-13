// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The clip page's player in React: the clock everything reads the playhead from, the <video>'s ref, what the
 * transport shows (playing, muted, looping, the shuttle's speed) and the moves (player-control.ts). Without a
 * copy to play (it isn't made yet) the clock still moves: the scrubber, the shots and the lines seek it and the
 * viewer shows the shot's best frame.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type RefCallback } from 'react';
import { usePlaybackActivity } from '../../../sounds/sound-activity-context';
import type { ShotSpan } from '../clip-time';
import { createClipClock, type ClipClock } from './clip-clock';
import { createPlayerControl, STOPPED, VIDEO_EVENTS, type PlayerSnapshot } from './player-control';

export interface ClipPlayer {
  readonly clock: ClipClock;
  readonly state: PlayerSnapshot;
  readonly length: number;
  readonly frameMs: number;
  readonly videoRef: RefCallback<HTMLVideoElement>;
  toggle(): void;
  pause(): void;
  shuttle(direction: -1 | 1): void;
  seek(at: number): void;
  stepFrame(direction: -1 | 1): void;
  grab(): void;
  release(): void;
  toggleMute(): void;
  toggleLoop(): void;
}

const FRAMES = {
  request: (callback: (now: number) => void) => requestAnimationFrame(callback),
  cancel: (handle: number) => cancelAnimationFrame(handle),
};

export function useClipPlayer(length: number, frameMs: number, spans: readonly ShotSpan[]): ClipPlayer {
  const setSoundPlayback = usePlaybackActivity();
  const [clock] = useState(() => createClipClock());
  const [state, setState] = useState<PlayerSnapshot>(STOPPED);
  const control = useMemo(
    () =>
      createPlayerControl(
        clock,
        (next) => {
          setSoundPlayback(next.playing);
          setState(next);
        },
        FRAMES,
      ),
    [clock, setSoundPlayback],
  );
  useLayoutEffect(() => control.configure({ length, frameMs, spans }), [control, length, frameMs, spans]);
  useEffect(() => () => control.dispose(), [control]);

  const videoRef = useCallback<RefCallback<HTMLVideoElement>>(
    (element) => {
      control.attach(element);
      if (!element) return;
      const controller = new AbortController();
      for (const name of VIDEO_EVENTS)
        element.addEventListener(name, () => control.event(name), { signal: controller.signal });
      // The element starts loading when it is made, which can be before React attaches it here: catch up.
      if (element.error) control.event('error');
      else {
        if (element.readyState >= HTMLMediaElement.HAVE_METADATA) control.event('loadedmetadata');
        if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) control.event('loadeddata');
      }
      return () => {
        controller.abort();
        control.attach(null);
      };
    },
    [control],
  );

  return {
    clock,
    state,
    length,
    frameMs,
    videoRef,
    toggle: control.toggle,
    pause: control.pause,
    shuttle: control.shuttle,
    seek: control.seek,
    stepFrame: control.stepFrame,
    grab: control.grab,
    release: control.release,
    toggleMute: control.toggleMute,
    toggleLoop: control.toggleLoop,
  };
}
