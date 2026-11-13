// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface LoopRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The kept reel's clock for the review (BRK1-REV). The <video> is the clock: while it plays, one animation frame
 * loop reads its time and hands it to the listeners (the playhead moves by a transform, never through React), and
 * wraps it round the slot being looped. React state changes only when playing starts or stops.
 */
export interface ReelPlayer {
  /** Give it to the <video>. */
  readonly attach: (video: HTMLVideoElement | null) => void;
  readonly playing: boolean;
  /** The video has a frame to show. */
  readonly ready: boolean;
  /** The video couldn't load (the reel's file is gone, or the host refused it). */
  readonly failed: boolean;
  /** Called with the time in seconds on every frame while playing, and after a seek. Returns the unsubscribe. */
  subscribe(listener: (seconds: number) => void): () => void;
  now(): number;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;
  /** Plays round this stretch while it plays; null plays on to the end. */
  setLoop(range: LoopRange | null): void;
}

/** Under one frame at 60 Hz: the loop wraps a little before its end, so the next slot's first frame never shows. */
const WRAP = 1 / 60;

export function useReelPlayer(): ReelPlayer {
  const video = useRef<HTMLVideoElement | null>(null);
  const listeners = useRef(new Set<(seconds: number) => void>());
  const loop = useRef<LoopRange | null>(null);
  const frame = useRef<number | null>(null);
  const time = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [element, setElement] = useState<HTMLVideoElement | null>(null);

  const publish = useCallback((seconds: number) => {
    time.current = seconds;
    for (const listener of listeners.current) listener(seconds);
  }, []);

  const tick = useCallback(() => {
    const el = video.current;
    frame.current = null;
    if (!el) return;
    let seconds = el.currentTime;
    const range = loop.current;
    if (range && !el.paused && (seconds >= range.end - WRAP || seconds < range.start - WRAP)) {
      el.currentTime = range.start;
      seconds = range.start;
    }
    publish(seconds);
    if (!el.paused && !el.ended) frame.current = requestAnimationFrame(tick);
  }, [publish]);

  // Stable, so React never detaches and re-attaches the same <video> when the player's state changes.
  const attach = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    setElement(el);
  }, []);

  useEffect(() => {
    const el = element;
    if (!el) {
      setReady(false);
      setPlaying(false);
      return;
    }
    const start = () => {
      setPlaying(true);
      if (frame.current === null) frame.current = requestAnimationFrame(tick);
    };
    const stop = () => {
      setPlaying(false);
      publish(el.currentTime);
    };
    const loaded = () => {
      setReady(true);
      setFailed(false);
    };
    const broke = () => setFailed(true);
    const sought = () => publish(el.currentTime);
    el.addEventListener('play', start);
    el.addEventListener('pause', stop);
    el.addEventListener('ended', stop);
    el.addEventListener('loadeddata', loaded);
    el.addEventListener('error', broke);
    el.addEventListener('seeked', sought);
    setReady(el.readyState >= 2);
    setPlaying(!el.paused);
    return () => {
      el.removeEventListener('play', start);
      el.removeEventListener('pause', stop);
      el.removeEventListener('ended', stop);
      el.removeEventListener('loadeddata', loaded);
      el.removeEventListener('error', broke);
      el.removeEventListener('seeked', sought);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [element, tick, publish]);

  return useMemo<ReelPlayer>(() => {
    const play = () => {
      const el = video.current;
      if (!el) return;
      const range = loop.current;
      if (range && (el.currentTime < range.start || el.currentTime >= range.end - WRAP))
        el.currentTime = range.start;
      // A play the browser refuses (no frame yet, or the file is gone) stays paused; `failed` says why. Older
      // engines answer no promise at all.
      const started = el.play() as Promise<void> | undefined;
      void started?.catch(() => undefined);
    };
    return {
      attach,
      playing,
      ready,
      failed,
      subscribe(listener) {
        listeners.current.add(listener);
        listener(time.current);
        return () => listeners.current.delete(listener);
      },
      now: () => time.current,
      play,
      pause: () => video.current?.pause(),
      toggle() {
        const el = video.current;
        if (!el) return;
        if (el.paused) play();
        else el.pause();
      },
      seek(seconds) {
        const el = video.current;
        publish(seconds);
        if (el && Number.isFinite(seconds)) el.currentTime = Math.max(0, seconds);
      },
      setLoop(range) {
        loop.current = range;
      },
    };
  }, [attach, playing, ready, failed, publish]);
}
