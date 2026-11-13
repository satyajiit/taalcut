// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The editor's playhead, outside React (P2-M7): the line over the tracks, the
 * transport's timecode and the viewer follow it by subscription and write
 * their transforms and text straight to the DOM, so scrubbing and playback
 * never re-render the page. While playing it runs its own clock on
 * requestAnimationFrame from the last frame the player reported, so the line
 * glides at the display's rate even when the player reports ten times a
 * second; each report puts it back on the player's time.
 */
import { useEffect, useRef, useState } from 'react';

export type SeekSource = 'user' | 'player';

type Listener = (frame: number, source: SeekSource) => void;

export interface Playhead {
  /** The frame on show (0-based). */
  frame(): number;
  /** Moves the playhead; clamped to the film. `player` reports don't seek the player again. */
  seek(frame: number, source?: SeekSource): void;
  subscribe(listener: Listener): () => void;
  playing(): boolean;
  /** What the viewer reports: playing started or stopped. */
  setPlaying(playing: boolean): void;
  /** Asks the viewer to play or pause (the transport, Space, a scrub that starts). */
  play(): void;
  pause(): void;
  toggle(): void;
  /** The viewer's own play and pause, bound by the page once the viewer is there. */
  bindTransport(transport: { play(): void; pause(): void } | null): void;
  subscribePlaying(listener: (playing: boolean) => void): () => void;
  /** The film's length and rate, for clamping and the clock. */
  setFilm(totalFrames: number, fps: number): void;
  total(): number;
}

export function createPlayhead(now: () => number = () => performance.now()): Playhead {
  let frame = 0;
  let total = 1;
  let fps = 30;
  let playing = false;
  let base = { frame: 0, at: 0 };
  let raf = 0;
  let transport: { play(): void; pause(): void } | null = null;
  const listeners = new Set<Listener>();
  const playingListeners = new Set<(playing: boolean) => void>();

  const clamp = (value: number) => Math.min(Math.max(0, Math.round(value)), Math.max(0, total - 1));
  const emit = (source: SeekSource) => {
    for (const listener of listeners) listener(frame, source);
  };

  const tick = () => {
    raf = 0;
    if (!playing) return;
    const next = clamp(base.frame + ((now() - base.at) / 1000) * fps);
    if (next !== frame) {
      frame = next;
      emit('player');
    }
    raf = requestAnimationFrame(tick);
  };

  const setPlaying = (next: boolean) => {
    if (next === playing) return;
    playing = next;
    base = { frame, at: now() };
    if (playing && !raf) raf = requestAnimationFrame(tick);
    if (!playing && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    for (const listener of playingListeners) listener(playing);
  };
  const pause = () => {
    if (transport) transport.pause();
    else setPlaying(false);
  };
  const play = () => transport?.play();

  return {
    frame: () => frame,
    total: () => total,
    seek(value, source = 'user') {
      const next = clamp(value);
      base = { frame: next, at: now() };
      if (next === frame && source === 'player') return;
      frame = next;
      emit(source);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    playing: () => playing,
    setPlaying,
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    bindTransport(next) {
      transport = next;
    },
    subscribePlaying(listener) {
      playingListeners.add(listener);
      return () => playingListeners.delete(listener);
    },
    setFilm(nextTotal, nextFps) {
      total = Math.max(1, nextTotal);
      fps = nextFps > 0 ? nextFps : 30;
      if (frame > total - 1) {
        frame = total - 1;
        emit('user');
      }
    },
  };
}

/** One playhead for the page's lifetime. */
export function usePlayhead(): Playhead {
  const ref = useRef<Playhead | null>(null);
  ref.current ??= createPlayhead();
  return ref.current;
}

/** Whether it is playing, as React state (the play button's icon: once per toggle, not per frame). */
export function usePlaying(playhead: Playhead): boolean {
  const [playing, setPlaying] = useState(playhead.playing());
  useEffect(() => playhead.subscribePlaying(setPlaying), [playhead]);
  return playing;
}

/**
 * Calls `onFrame` for every playhead move, at most once per animation frame,
 * outside React: for writing a transform or a timecode's text.
 */
export function usePlayheadFrame(playhead: Playhead, onFrame: (frame: number, source: SeekSource) => void) {
  const latest = useRef(onFrame);
  useEffect(() => {
    latest.current = onFrame;
  });
  useEffect(() => {
    latest.current(playhead.frame(), 'user');
    return playhead.subscribe((frame, source) => latest.current(frame, source));
  }, [playhead]);
}
