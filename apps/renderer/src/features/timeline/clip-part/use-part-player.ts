// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: the file's own video behind the Trim tool's picture. Still, it shows the exact frame asked for (the
 * frame an end is dragged to, the part's first frame): the filmstrip has at most 80 frames for the whole file, the
 * copy to play has every one. Playing, it runs the chosen part from its first frame to its last and starts over,
 * until stopped; the part's limits are read as it runs, so a part that moved plays from its new place. Without a
 * copy to play nothing here does anything and the picture stays the filmstrip's.
 */
import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react';
import { usePlaybackActivity } from '../../sounds/sound-activity-context';

export interface PartPlayer {
  readonly videoRef: RefCallback<HTMLVideoElement>;
  /** The video has a frame to show. */
  readonly ready: boolean;
  /** The copy to play couldn't be read. */
  readonly failed: boolean;
  readonly playing: boolean;
  toggle(): void;
  stop(): void;
}

/** Past the part's end by less than this, a seek back counts as the loop (seconds). */
const EDGE_S = 0.02;

/** Starts the video; `refused` when the browser won't (nothing decoded yet, or playing isn't allowed). */
function run(video: HTMLVideoElement, refused: () => void): void {
  try {
    void Promise.resolve(video.play()).catch(refused);
  } catch {
    refused();
  }
}

export function usePartPlayer(input: {
  /** What the video loads; undefined without a copy to play. */
  src: string | undefined;
  /** The part, in milliseconds from the file's first frame. */
  fromMs: number;
  toMs: number;
  /** The frame to show while still, in milliseconds. */
  atMs: number;
  muted: boolean;
}): PartPlayer {
  const { src, fromMs, toMs, atMs, muted } = input;
  const setSoundPlayback = usePlaybackActivity();
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const span = useRef({ fromMs, toMs });
  span.current = { fromMs, toMs };
  const wanted = useRef<number | null>(null);

  const videoRef = useCallback<RefCallback<HTMLVideoElement>>((element) => setVideo(element), []);

  // Another file: nothing of the last one stands.
  useEffect(() => {
    setReady(false);
    setFailed(false);
    setPlaying(false);
  }, [src, video]);

  useEffect(() => {
    if (!video) return;
    const controller = new AbortController();
    const on = (name: string, run: () => void) =>
      video.addEventListener(name, run, { signal: controller.signal });
    on('loadeddata', () => setReady(true));
    on('error', () => {
      setFailed(true);
      setPlaying(false);
    });
    // The file's own end inside the part is the loop's turn, not a stop.
    on('pause', () => {
      if (!video.ended) setPlaying(false);
    });
    on('ended', () => {
      video.currentTime = span.current.fromMs / 1000;
      run(video, () => setPlaying(false));
    });
    on('seeked', () => {
      // The newest frame asked for while the last seek ran.
      const next = wanted.current;
      wanted.current = null;
      if (next !== null && Math.abs(video.currentTime - next) > 1e-3) video.currentTime = next;
    });
    if (video.error) setFailed(true);
    else if (video.readyState >= 2) setReady(true);
    return () => controller.abort();
  }, [video]);

  // Still: the frame asked for. One seek at a time; the newest request waits for the one running.
  useEffect(() => {
    if (!video || playing || failed) return;
    const at = Math.max(0, atMs / 1000);
    if (video.seeking) wanted.current = at;
    else if (Math.abs(video.currentTime - at) > 1e-3) video.currentTime = at;
  }, [video, atMs, playing, failed, ready]);

  // Playing: back to the part's first frame whenever the playhead leaves the part.
  useEffect(() => {
    if (!video || !playing) return;
    setSoundPlayback(true);
    let frame = 0;
    const tick = () => {
      const { fromMs: from, toMs: to } = span.current;
      const now = video.currentTime;
      if (now >= to / 1000 - EDGE_S || now < from / 1000 - EDGE_S || video.ended) {
        video.currentTime = from / 1000;
        if (video.paused) run(video, () => setPlaying(false));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setSoundPlayback(false);
    };
  }, [video, playing, setSoundPlayback]);

  const stop = useCallback(() => {
    setPlaying(false);
    video?.pause();
  }, [video]);

  const toggle = () => {
    if (!video || failed) return;
    if (playing) return stop();
    wanted.current = null;
    video.muted = muted;
    video.currentTime = span.current.fromMs / 1000;
    setPlaying(true);
    run(video, () => setPlaying(false));
  };

  // Leaving the tool stops the sound with it.
  useEffect(() => () => video?.pause(), [video]);

  return { videoRef, ready: ready && !failed, failed, playing, toggle, stop };
}
