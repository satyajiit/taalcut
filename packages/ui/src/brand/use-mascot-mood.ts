// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useEffect, useRef, useState } from 'react';
import type { MascotMood } from './kaatu-frames';
import { onThemeScene } from '../theme/theme-scene';

/** How long nobody touches the app before Kaatu dozes off. */
export const SLEEP_AFTER_MS = 60_000;
/** How long the grin lasts after a run finishes well. */
export const HAPPY_MS = 1600;
/** How long the bashful look lasts after a run fails. */
export const OOPS_MS = 2400;
/** How long the mascot dozes after you bring on the night (the theme scene's nightfall). */
export const DOZE_MS = 1600;

const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin'] as const;

export interface IdleMoodOptions {
  /** Doze after this long without a pointer, key or wheel event. */
  sleepAfterMs?: number;
  /** A mood to open with (a not-found page opens bashful), held for `startMs`. */
  startWith?: MascotMood;
  startMs?: number;
}

/**
 * Kaatu where nothing is running: idle (watching the pointer), asleep after a
 * long while with no activity, awake again on the next pointer move or key.
 * Once after you flip the theme: a short doze at nightfall, a grin at daybreak.
 */
export function useIdleMood({
  sleepAfterMs = SLEEP_AFTER_MS,
  startWith,
  startMs = OOPS_MS,
}: IdleMoodOptions = {}): MascotMood {
  const [opening, setOpening] = useState(startWith !== undefined);
  const [asleep, setAsleep] = useState(false);
  // Once after the day/night scene: a doze at nightfall, a grin at daybreak. Any character with the two moods.
  const [scene, setScene] = useState<MascotMood | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const off = onThemeScene((kind) => {
      window.clearTimeout(timer);
      setScene(kind === 'nightfall' ? 'sleep' : 'happy');
      timer = window.setTimeout(() => setScene(null), kind === 'nightfall' ? DOZE_MS : HAPPY_MS);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!opening) return;
    const id = window.setTimeout(() => setOpening(false), startMs);
    return () => window.clearTimeout(id);
  }, [opening, startMs]);

  useEffect(() => {
    let timer = window.setTimeout(() => setAsleep(true), sleepAfterMs);
    let last = Date.now();
    const wake = () => {
      setAsleep(false);
      // Pointer moves arrive many times a second: restart the countdown at most once a second.
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAsleep(true), sleepAfterMs);
    };
    for (const type of ACTIVITY) window.addEventListener(type, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const type of ACTIVITY) window.removeEventListener(type, wake);
    };
  }, [sleepAfterMs]);

  if (opening && startWith) return startWith;
  if (scene) return scene;
  return asleep ? 'sleep' : 'idle';
}

/** How a run stands, as the chat knows it (the renderer maps its transcript onto this). */
export type RunPhase = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused';

export interface RunMoodInput {
  /** A message is on its way or a run is going. A run waiting for an answer doesn't count. */
  busy: boolean;
  /** The chat's newest run, if it has one. */
  latest: { id: string; phase: RunPhase } | null;
}

export interface RunMood {
  mood: MascotMood;
  /** Whether the working line shows: while busy, and for a moment after a run this page watched ends. */
  visible: boolean;
}

/**
 * Kaatu in the agent's working line. Thinking while a run goes; a short grin
 * when one this page watched finishes well; a short bashful look when it fails
 * (kind, never dizzy); gone when it is stopped or waits for an answer. Opening
 * a chat whose last run ended long ago shows nothing.
 */
export function useRunMood({ busy, latest }: RunMoodInput): RunMood {
  const watched = useRef<string | null>(null);
  const [after, setAfter] = useState<{ mood: 'happy' | 'oops'; id: string } | null>(null);
  const id = latest?.id ?? null;
  const phase = latest?.phase ?? null;

  useEffect(() => {
    if (busy) {
      // Remember the run seen going, so its ending gets the reaction. A message still on its
      // way has no run yet: the newest one is an older, finished run, and must not grin again.
      if (phase === 'running') watched.current = id;
      setAfter(null);
      return;
    }
    if (id === null || id !== watched.current) return;
    watched.current = null;
    if (phase === 'succeeded') setAfter({ mood: 'happy', id });
    else if (phase === 'failed') setAfter({ mood: 'oops', id });
  }, [busy, id, phase]);

  useEffect(() => {
    if (!after) return;
    const timer = window.setTimeout(() => setAfter(null), after.mood === 'happy' ? HAPPY_MS : OOPS_MS);
    return () => window.clearTimeout(timer);
  }, [after]);

  if (busy) return { mood: 'thinking', visible: true };
  if (after) return { mood: after.mood, visible: true };
  return { mood: 'idle', visible: false };
}
