// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { MEDIA_HOST, PREVIEW_HOST } from '@taalcut/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditsAudioTrack } from '../make/edits-pulse-model';
import { usePlaybackActivity } from '../sounds/sound-activity-context';

/** Remote feed URLs are metadata until main supplies a route allowed by the app's media policy. */
export function canPreviewTrack(track: EditsAudioTrack): boolean {
  if (!track.previewUrl) return false;
  try {
    const url = new URL(track.previewUrl);
    if (url.username || url.password) return false;
    return url.protocol === 'app:' && [MEDIA_HOST, PREVIEW_HOST].includes(url.host);
  } catch {
    return false;
  }
}

export function useAudioPreview() {
  const setSoundPlayback = usePlaybackActivity();
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorTrackId, setErrorTrackId] = useState<string | null>(null);
  const session = useRef<{
    audio: HTMLAudioElement;
    trackId: string;
  } | null>(null);

  const stop = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (current) {
      current.audio.pause();
      current.audio.removeAttribute('src');
      current.audio.load();
    }
    setSoundPlayback(false);
    setPlayingTrackId(null);
    setElapsedSeconds(0);
  }, [setSoundPlayback]);

  const start = useCallback(
    (track: EditsAudioTrack, seconds = 0) => {
      stop();
      setErrorTrackId(null);
      // Edits' music-details tool is metadata-only; a feed's hasPreview flag is not a playback contract.
      if (!canPreviewTrack(track)) return;
      const audio = new Audio(track.previewUrl);
      const current = { audio, trackId: track.id };
      session.current = current;
      const isCurrent = () => session.current === current;
      const fail = () => {
        if (!isCurrent()) return;
        stop();
        setErrorTrackId(track.id);
      };
      audio.onloadedmetadata = () => {
        if (isCurrent() && seconds > 0 && Number.isFinite(audio.duration)) {
          audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
        }
      };
      audio.ontimeupdate = () => {
        if (isCurrent()) setElapsedSeconds(audio.currentTime);
      };
      audio.onended = () => {
        if (isCurrent()) stop();
      };
      audio.onerror = fail;
      setSoundPlayback(true);
      try {
        void audio.play().then(() => {
          if (isCurrent()) setPlayingTrackId(track.id);
          else audio.pause();
        }, fail);
      } catch {
        fail();
      }
    },
    [stop, setSoundPlayback],
  );

  const toggleTrack = useCallback(
    (track: EditsAudioTrack, seconds = 0) => {
      if (session.current?.trackId === track.id && seconds === 0) stop();
      else start(track, seconds);
    },
    [start, stop],
  );

  const seekTrack = useCallback(
    (track: EditsAudioTrack, seconds: number) => {
      const current = session.current;
      if (current?.trackId === track.id && Number.isFinite(current.audio.duration)) {
        current.audio.currentTime = Math.max(0, Math.min(seconds, current.audio.duration));
      } else start(track, seconds);
    },
    [start],
  );

  useEffect(() => () => stop(), [stop]);
  return { playingTrackId, elapsedSeconds, errorTrackId, toggleTrack, seekTrack, stop };
}
