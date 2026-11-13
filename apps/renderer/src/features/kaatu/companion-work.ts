// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the companion knows of the app's work (UX4): what is running now (an agent's run, an import, indexing, a
 * download, an export), and a short pulse when something ends: a grin when the work is done, a bashful look when
 * something fails. Kept outside React, fed by the backend's events (companion-events.ts) and by pages that know
 * more (the chat's run), so the companion reads the same on every page and across Settings.
 *
 * - A grin needs the work to be over: when the last running thing succeeds and nothing starts again for a moment
 *   (indexing runs file after file; it grins once, at the end). An export that finishes grins at once: it is the
 *   moment.
 * - A failure looks bashful at once, but not again within ten seconds, so a run of failures doesn't loop.
 */
import { HAPPY_MS, OOPS_MS } from '@taalcut/ui';

export type WorkPhase = 'running' | 'succeeded' | 'failed' | 'stopped';
export type WorkPulse = 'happy' | 'oops';

export interface CompanionWork {
  /** Something is running. */
  readonly busy: boolean;
  /** A grin or a bashful look, for a moment. */
  readonly pulse: WorkPulse | null;
}

/** How long nothing may start again after the last success before the grin. */
export const SETTLE_MS = 800;
/** No second bashful look within this. */
export const OOPS_COOLDOWN_MS = 10_000;

const running = new Set<string>();
let pulse: WorkPulse | null = null;
let snapshot: CompanionWork = { busy: false, pulse: null };
let pulseTimer: ReturnType<typeof setTimeout> | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let lastOops = Number.NEGATIVE_INFINITY;
const listeners = new Set<() => void>();

function publish(): void {
  const next = { busy: running.size > 0, pulse };
  if (next.busy === snapshot.busy && next.pulse === snapshot.pulse) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function pulseFor(mood: WorkPulse): void {
  if (mood === 'oops') {
    const now = Date.now();
    if (now - lastOops < OOPS_COOLDOWN_MS) return;
    lastOops = now;
  }
  clearTimeout(pulseTimer);
  pulse = mood;
  publish();
  pulseTimer = setTimeout(
    () => {
      pulse = null;
      publish();
    },
    mood === 'happy' ? HAPPY_MS : OOPS_MS,
  );
}

/** Whether `key` is running, for an adapter that reports an end only for what it saw start. */
export function workRunning(key: string): boolean {
  return running.has(key);
}

/**
 * Reports a piece of work by a key of the caller's (`job:<id>`, `chat:<id>`). `moment`: a success that grins at
 * once, whatever else runs (an export finished).
 */
export function reportWork(
  key: string,
  phase: WorkPhase,
  { moment = false }: { moment?: boolean } = {},
): void {
  if (phase === 'running') {
    running.add(key);
    clearTimeout(settleTimer);
    publish();
    return;
  }
  running.delete(key);
  publish();
  if (phase === 'failed') pulseFor('oops');
  else if (phase === 'succeeded' && moment) pulseFor('happy');
  else if (phase === 'succeeded') {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (running.size === 0) pulseFor('happy');
    }, SETTLE_MS);
  }
}

export function subscribeWork(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function companionWork(): CompanionWork {
  return snapshot;
}

/** Tests: forget everything. */
export function resetCompanionWork(): void {
  running.clear();
  pulse = null;
  clearTimeout(pulseTimer);
  clearTimeout(settleTimer);
  lastOops = Number.NEGATIVE_INFINITY;
  snapshot = { busy: false, pulse: null };
}
