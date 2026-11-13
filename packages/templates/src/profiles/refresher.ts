// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keeping style profiles fresh (LRN1-STY). A template write (`library.changed`, entity 'template': a new template, a
 * new version, a folder or tag change, a saved Reel linked) or a finished render may change any set's members, so
 * after a quiet spell every stored profile is checked against its digest and rebuilt only if it changed, and every
 * watched Instagram collection's profile is built if it isn't stored yet. A watched collection's sync asks for its
 * set by name (`nudge`), so its profile follows the Reels it breaks down before anyone opens it.
 * Runs never overlap: changes that arrive during a run schedule one more.
 */
import { styleSourceKey, type EventBus, type StyleSource, type Unsubscribe } from '@taalcut/core';
import type { StyleProfiles } from './style-profiles';

/** How long templates must stay unchanged before profiles are checked: a breakdown writes several versions. */
export const PROFILE_REFRESH_QUIET_MS = 5_000;

export interface StyleProfileRefresher {
  /** Builds (or checks) these sets at the next quiet moment, stored or not. */
  nudge(sources: readonly StyleSource[]): void;
  /** Resolves when no refresh is waiting or running (tests). */
  idle(): Promise<void>;
  stop(): void;
}

export interface StyleProfileRefresherDeps {
  readonly profiles: Pick<StyleProfiles, 'refresh' | 'refreshAll'>;
  readonly events: Pick<EventBus, 'on'>;
  /** Sets kept built though no one opened them yet: the watched Instagram collections. */
  readonly watched?: () => Promise<readonly StyleSource[]>;
  readonly quietMs?: number;
  readonly log?: (line: string) => void;
}

/** The refresher's state: the sets asked for, whether everything is due, and the timer and run in progress. */
interface Refreshing {
  readonly deps: StyleProfileRefresherDeps;
  readonly quietMs: number;
  readonly controller: AbortController;
  readonly nudged: Map<string, StyleSource>;
  everything: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  running: Promise<void> | undefined;
  /** A change arrived during the run: schedule one more when it ends. */
  again: boolean;
}

function note(state: Refreshing, sources: readonly StyleSource[]): void {
  for (const source of sources) state.nudged.set(styleSourceKey(source), source);
}

async function run(state: Refreshing): Promise<void> {
  const { deps, controller } = state;
  const all = state.everything;
  state.everything = false;
  if (all && deps.watched) note(state, await deps.watched());
  const sources = [...state.nudged.values()];
  state.nudged.clear();
  for (const source of sources) {
    const done = await deps.profiles.refresh(source, controller.signal);
    if (!done.ok) deps.log?.(`style profile ${styleSourceKey(source)} not built: ${done.error.code}`);
  }
  if (!all) return;
  const done = await deps.profiles.refreshAll(controller.signal);
  if (!done.ok) deps.log?.(`style profiles not refreshed: ${done.error.code}`);
}

function start(state: Refreshing): void {
  state.timer = undefined;
  if (state.controller.signal.aborted) return;
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = run(state).finally(() => {
    state.running = undefined;
    if (!state.again) return;
    state.again = false;
    schedule(state);
  });
}

function schedule(state: Refreshing): void {
  if (state.controller.signal.aborted) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(() => start(state), state.quietMs);
  state.timer.unref?.();
}

async function idle(state: Refreshing): Promise<void> {
  while (state.timer !== undefined || state.running) {
    if (state.timer !== undefined) {
      clearTimeout(state.timer);
      start(state);
    }
    await state.running;
  }
}

export function createStyleProfileRefresher(deps: StyleProfileRefresherDeps): StyleProfileRefresher {
  const state: Refreshing = {
    deps,
    quietMs: deps.quietMs ?? PROFILE_REFRESH_QUIET_MS,
    controller: new AbortController(),
    nudged: new Map(),
    everything: false,
    timer: undefined,
    running: undefined,
    again: false,
  };
  const unsubscribe: Unsubscribe = deps.events.on('library.changed', ({ payload }) => {
    if (payload.entity !== 'template' && payload.entity !== 'render') return;
    state.everything = true;
    schedule(state);
  });
  return {
    nudge(sources) {
      note(state, sources);
      if (sources.length > 0) schedule(state);
    },
    idle: () => idle(state),
    stop() {
      state.controller.abort();
      clearTimeout(state.timer);
      state.timer = undefined;
      unsubscribe();
    },
  };
}
