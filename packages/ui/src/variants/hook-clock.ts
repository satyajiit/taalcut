// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one clock every preview of a compare view follows (P3-V3): Play the hooks starts every player at frame 0 at
 * once and starts them all again every hook window; Play all plays each in turn for its own length; Stop stops
 * them together. Players never keep their own time: they start again when `epoch` moves.
 */
import type { HOOK_WINDOW_SECONDS } from '@taalcut/core';
import { useCallback, useEffect, useReducer } from 'react';

/** core's HOOK_WINDOW_SECONDS: the kit may import only core's types, so the type keeps the two in step. */
export const HOOK_WINDOW: typeof HOOK_WINDOW_SECONDS = 3;

export type HookMode = 'stopped' | 'hooks' | 'all';

export interface HookClockState {
  readonly mode: HookMode;
  /** Bumped every time the players start again together (a loop of the hooks, the next video in turn). */
  readonly epoch: number;
  /** With 'all': the preview playing now. */
  readonly turn: number;
}

export type HookClockEvent =
  | { readonly type: 'hooks' }
  | { readonly type: 'all' }
  | { readonly type: 'stop' }
  /** The window or the turn ran out; `count` is how many previews there are now. */
  | { readonly type: 'tick'; readonly count: number };

export const STOPPED: HookClockState = { mode: 'stopped', epoch: 0, turn: 0 };

export function stepClock(state: HookClockState, event: HookClockEvent): HookClockState {
  switch (event.type) {
    case 'hooks':
      return { mode: 'hooks', epoch: state.epoch + 1, turn: 0 };
    case 'all':
      return { mode: 'all', epoch: state.epoch + 1, turn: 0 };
    case 'stop':
      return { ...state, mode: 'stopped', turn: 0 };
    case 'tick':
      if (state.mode === 'hooks') return { ...state, epoch: state.epoch + 1 };
      if (state.mode === 'all' && state.turn + 1 < event.count)
        return { mode: 'all', epoch: state.epoch + 1, turn: state.turn + 1 };
      return { ...state, mode: 'stopped', turn: 0 };
  }
}

export interface HookClock extends HookClockState {
  playHooks(): void;
  playAll(): void;
  stop(): void;
  /** Whether preview `index` plays now. */
  playing(index: number): boolean;
}

/**
 * The clock over `lengthsMs` (each preview's length; null while unknown, which Play all gives one hook window).
 * One timer at a time, cleared on every change and on unmount, so nothing plays after the view goes.
 */
export function useHookClock(
  lengthsMs: readonly (number | null)[],
  windowMs = HOOK_WINDOW * 1000,
): HookClock {
  const [state, send] = useReducer(stepClock, STOPPED);
  const count = lengthsMs.length;
  const turnMs = state.mode === 'all' ? (lengthsMs[state.turn] ?? windowMs) : windowMs;

  useEffect(() => {
    if (state.mode === 'stopped') return;
    const timer = setTimeout(() => send({ type: 'tick', count }), Math.max(1, turnMs));
    return () => clearTimeout(timer);
  }, [state.mode, state.epoch, turnMs, count]);

  // Nothing left to play (the previews went): stop.
  useEffect(() => {
    if (count === 0 && state.mode !== 'stopped') send({ type: 'stop' });
  }, [count, state.mode]);

  const playHooks = useCallback(() => send({ type: 'hooks' }), []);
  const playAll = useCallback(() => send({ type: 'all' }), []);
  const stop = useCallback(() => send({ type: 'stop' }), []);
  return {
    ...state,
    playHooks,
    playAll,
    stop,
    playing: (index) => state.mode === 'hooks' || (state.mode === 'all' && state.turn === index),
  };
}
