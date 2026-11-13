// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MascotDirection } from '@taalcut-vendor/page-mascot/mascot';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ANTICS,
  ANTIC_NAMES,
  CALM_POKES,
  DIZZY,
  DOZE,
  POKES,
  SHY,
  THINKING,
  TURN_MS,
  WAKE,
  blinkClip,
  type Clip,
  type KaatuAntic,
} from './kaatu-acts';
import { facing, turnPath, type KaatuFrame, type MascotMood } from './kaatu-frames';
import { playMove } from './kaatu-moves';

const BLINK_MIN = 2400;
const BLINK_MAX = 6000;
const DOUBLE_BLINK = 0.18;
/** The first antic comes a little after Kaatu appears, then one every so often. */
const FIRST_ANTIC = [5000, 9000] as const;
const ANTIC_EVERY = [9000, 16_000] as const;
/** Antics just played are left out of the next draw, so none repeats soon. */
const ANTIC_MEMORY = 3;
/** After a poke, an antic or a change of mood, this long before Kaatu starts another antic. */
const QUIET_AFTER = 4000;
const HOVER_MS = 650;
const DIZZY_AFTER = 4;
const DIZZY_WINDOW = 1600;
/** A poke this soon after the last gets a small squash, not a second hop. */
const QUICK_POKE = 700;

/** Who may cut in: a poke over a change of mood over an antic over a blink or a turn. */
const PRIORITY = { turn: 0, antic: 1, mood: 2, poke: 3 } as const;

/** The face a held mood shows. */
const MOOD_FACE: Partial<Record<MascotMood, KaatuFrame>> = {
  happy: 'delighted',
  oops: 'bashful',
  sleep: 'sleepy',
};

export interface KaatuPlayerOptions {
  mood: MascotMood;
  /** Blink now and then while idle. */
  blink: boolean;
  /** Get up to antics now and then while idle (never under reduced motion). */
  antics: boolean;
  reduce: boolean;
  /** Milliseconds per look while thinking; doubled under reduced motion. */
  thinkingBeatMs?: number;
  /** The element body moves play on. */
  stage: RefObject<HTMLElement | null>;
  /** When antics come, in ms: the first after `first`, then one every `every` (the calm companion's are rarer). */
  anticTiming?: { readonly first: readonly [number, number]; readonly every: readonly [number, number] };
}

export interface KaatuPlayer {
  frame: KaatuFrame;
  /** Where the pointer is, from the stage. */
  look: (direction: MascotDirection) => void;
  poke: () => void;
  hover: (over: boolean) => void;
  /** Play one antic now (the dev kit's preview). */
  perform: (antic: KaatuAntic) => void;
}

const between = ([min, max]: readonly [number, number]) => min + Math.random() * (max - min);

/**
 * Kaatu's frame from moment to moment. A held frame comes from the mood (where the
 * pointer is while idle, the thinking beats, a face); clips play over it: a turn's
 * in-betweens, blinks, antics, pokes, nodding off and waking up. When a clip ends
 * the head turns back through the in-betweens to whatever the mood holds by then.
 */
export function useKaatuPlayer({
  mood,
  blink,
  antics,
  reduce,
  thinkingBeatMs = 1000,
  stage,
  anticTiming,
}: KaatuPlayerOptions): KaatuPlayer {
  const firstAntic = anticTiming?.first ?? FIRST_ANTIC;
  const anticEvery = anticTiming?.every ?? ANTIC_EVERY;
  const [look, setLook] = useState<MascotDirection>('center');
  const [beat, setBeat] = useState(0);
  const [override, setOverride] = useState<KaatuFrame | null>(null);
  const running = useRef<{ priority: number; timers: number[] } | null>(null);
  const shown = useRef<KaatuFrame>('center');
  const held = useRef<KaatuFrame>('center');
  const moodRef = useRef(mood);
  const pokes = useRef({ count: 0, at: 0, next: 0 });
  const hoverTimer = useRef(0);
  const quietUntil = useRef(0);

  const tracking = mood === 'idle' || mood === 'poke';
  const base: KaatuFrame =
    mood === 'thinking'
      ? (THINKING[beat % THINKING.length] ?? 'up-left')
      : (MOOD_FACE[mood] ?? (tracking ? look : 'center'));
  const frame = override ?? base;

  const stop = useCallback(() => {
    running.current?.timers.forEach((id) => window.clearTimeout(id));
    running.current = null;
  }, []);

  const play = useCallback(
    (clip: Clip, priority: number): boolean => {
      if (clip.length === 0 || (running.current && running.current.priority > priority)) return false;
      stop();
      const timers: number[] = [];
      running.current = { priority, timers };
      let at = 0;
      for (const { frame: next, ms, move } of clip) {
        const start = () => {
          setOverride(next);
          if (move && !reduce) playMove(stage.current, move);
        };
        if (at === 0) start();
        else timers.push(window.setTimeout(start, at));
        at += ms;
      }
      timers.push(
        window.setTimeout(() => {
          running.current = null;
          if (priority > PRIORITY.turn) quietUntil.current = Date.now() + QUIET_AFTER;
          // Turn back to what the mood holds now, through the in-betweens. A turn's own
          // in-betweens already lead there.
          const settle = !reduce && priority > PRIORITY.turn;
          const path = settle ? turnPath(facing(shown.current), facing(held.current)) : [];
          if (
            !play(
              path.map((f) => ({ frame: f, ms: TURN_MS })),
              PRIORITY.turn,
            )
          )
            setOverride(null);
        }, at),
      );
      return true;
    },
    [reduce, stage, stop],
  );

  // A change of mood cancels what was playing; some moods come in with a move.
  // Declared before the turn below, so a doze or a wake claims the frame first.
  useLayoutEffect(() => {
    const was = moodRef.current;
    moodRef.current = mood;
    if (was === mood) return;
    stop();
    setOverride(null);
    if (reduce) return;
    if (was === 'idle' && mood === 'sleep') play(DOZE, PRIORITY.mood);
    else if (was === 'sleep' && mood === 'idle') play(WAKE, PRIORITY.mood);
    else if (mood === 'happy') playMove(stage.current, 'hop');
    else if (mood === 'oops') playMove(stage.current, 'droop');
  }, [mood, play, reduce, stage, stop]);

  // When the held frame changes (the pointer moved, a thinking beat), turn through the
  // in-betweens. Declared before `shown` is updated, so it still holds the frame on screen.
  useLayoutEffect(() => {
    held.current = base;
    if (reduce || (running.current && running.current.priority > PRIORITY.turn)) return;
    const path = turnPath(facing(shown.current), facing(base));
    if (path.length)
      play(
        path.map((f) => ({ frame: f, ms: TURN_MS })),
        PRIORITY.turn,
      );
  }, [base, play, reduce]);

  useLayoutEffect(() => {
    shown.current = frame;
  });

  // Thinking: a slow look up-left and up-right. Under reduced motion it keeps
  // going, slower, the way a loader does: a still mascot would read as stuck.
  useEffect(() => {
    if (mood !== 'thinking') return;
    setBeat(0);
    const id = window.setInterval(() => setBeat((n) => n + 1), reduce ? thinkingBeatMs * 2 : thinkingBeatMs);
    return () => window.clearInterval(id);
  }, [mood, reduce, thinkingBeatMs]);

  // Idle: a blink every few seconds, at an uneven pace so it never ticks.
  useEffect(() => {
    if (!blink || mood !== 'idle') return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          if (!running.current)
            play(blinkClip(facing(shown.current), !reduce, Math.random() < DOUBLE_BLINK), PRIORITY.turn);
          schedule();
        },
        between([BLINK_MIN, BLINK_MAX]),
      );
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [blink, mood, play, reduce]);

  // Idle: an antic now and then, never two of the same close together, not straight
  // after another act, and not while the window is hidden.
  useEffect(() => {
    if (!antics || reduce || mood !== 'idle') return;
    let timer = 0;
    let recent: KaatuAntic[] = [];
    const fire = () => {
      const busy = running.current && running.current.priority > PRIORITY.turn;
      if (document.hidden || busy || Date.now() < quietUntil.current) {
        timer = window.setTimeout(fire, between([3000, 6000]));
        return;
      }
      const pool = ANTIC_NAMES.filter((name) => !recent.includes(name));
      const name = pool[Math.floor(Math.random() * pool.length)] ?? 'wave';
      recent = [name, ...recent].slice(0, ANTIC_MEMORY);
      play(ANTICS[name], PRIORITY.antic);
      timer = window.setTimeout(fire, between(anticEvery));
    };
    timer = window.setTimeout(fire, between(firstAntic));
    return () => window.clearTimeout(timer);
  }, [antics, mood, play, reduce, firstAntic, anticEvery]);

  const poke = useCallback(() => {
    const now = Date.now();
    const state = pokes.current;
    const quick = now - state.at < QUICK_POKE;
    state.count = now - state.at < DIZZY_WINDOW ? state.count + 1 : 1;
    state.at = now;
    if (state.count >= DIZZY_AFTER) {
      state.count = 0;
      play(DIZZY, PRIORITY.poke);
      return;
    }
    const pool = reduce ? CALM_POKES : POKES;
    play(pool[state.next % pool.length] ?? DIZZY, PRIORITY.poke);
    state.next += 1;
    if (!reduce) playMove(stage.current, quick ? 'boop' : 'hop');
  }, [play, reduce, stage]);

  // A poke asked for by the page plays once, each time the mood becomes poke.
  useEffect(() => {
    if (mood === 'poke') poke();
  }, [mood, poke]);

  const hover = useCallback(
    (over: boolean) => {
      window.clearTimeout(hoverTimer.current);
      if (over && moodRef.current === 'idle')
        hoverTimer.current = window.setTimeout(() => play(SHY, PRIORITY.antic), HOVER_MS);
    },
    [play],
  );

  const perform = useCallback(
    (antic: KaatuAntic) => {
      play(ANTICS[antic], PRIORITY.poke);
    },
    [play],
  );

  useEffect(
    () => () => {
      stop();
      window.clearTimeout(hoverTimer.current);
    },
    [stop],
  );

  return { frame, look: setLook, poke, hover, perform };
}
