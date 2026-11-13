// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Follows the agent's runs for G8: a run waiting for a model limit gets a timer that resumes it when the limit
 * lifts (the wait is in its log, so at start every open run waiting on one is found and timed again); while
 * a run waits, the usage limits show it waiting on the provider; and each outcome (switched, waited, stopped)
 * is recorded as `rateLimit.met` telemetry (enums only).
 */
import type { Telemetry, RunId } from '@taalcut/core';
import type { Agent } from '../agent-types';
import type { EventLogStore } from '../ports';
import { foldEvents } from '../state';
import type { RateLimitCard } from './limit-cards';

export interface TimerPort {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface RateLimitFollowerDeps {
  readonly agent: Pick<Agent, 'subscribe' | 'resume'>;
  /** The run log, to find waiting runs at start. */
  readonly log: Pick<EventLogStore, 'openRuns' | 'read'>;
  readonly telemetry?: Telemetry;
  /** models' usage limits tracker: a waiting run is shown waiting on the provider's limits. */
  readonly limits?: { hold(provider: string, waiter: 'run'): () => void };
  readonly now?: () => number;
  readonly timers?: TimerPort;
}

export interface RateLimitFollower {
  /** Times every open run that waits for a limit (after a restart). */
  start(): Promise<void>;
  /** Stops following: timers cleared, holds released. */
  close(): void;
}

/** setTimeout's longest delay; a longer wait sets a new timer when this one fires. */
const MAX_TIMER_MS = 2_147_483_647;

const defaultTimers: TimerPort = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createRateLimitFollower(deps: RateLimitFollowerDeps): RateLimitFollower {
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? defaultTimers;
  const scheduled = new Map<RunId, unknown>();
  const holds = new Map<RunId, () => void>();
  let closed = false;

  const resume = (runId: RunId) => {
    scheduled.delete(runId);
    void deps.agent.resume(runId).then((resumed) => {
      if (!resumed.ok)
        console.warn(`[agent] run ${runId} didn't resume after its limit: ${resumed.error.code}`);
    });
  };

  const schedule = (runId: RunId, until: number) => {
    if (closed) return;
    const known = scheduled.get(runId);
    if (known !== undefined) timers.clear(known);
    const wait = Math.max(0, until - now());
    // A wait past the timer's range sets a new timer when this one fires: the gate pauses the run again.
    scheduled.set(
      runId,
      timers.set(() => resume(runId), Math.min(wait, MAX_TIMER_MS)),
    );
  };

  const release = (runId: RunId) => {
    holds.get(runId)?.();
    holds.delete(runId);
    const known = scheduled.get(runId);
    if (known !== undefined) timers.clear(known);
    scheduled.delete(runId);
  };

  const onCard = (runId: RunId, card: RateLimitCard) => {
    if (card.status === 'waiting') {
      if (!holds.has(runId) && deps.limits) holds.set(runId, deps.limits.hold(card.from.provider, 'run'));
      // The card asks first (approvalId); without one the person chose to wait.
      if (!card.approvalId) record(card, 'waited');
      return;
    }
    holds.get(runId)?.();
    holds.delete(runId);
    if (card.status === 'switched') record(card, 'switched');
    else if (card.status === 'stopped') record(card, 'stopped');
  };

  const record = (card: RateLimitCard, outcome: 'switched' | 'waited' | 'stopped') => {
    try {
      deps.telemetry?.record({ name: 'rateLimit.met', module: card.module, reason: card.reason, outcome });
    } catch {
      // Telemetry never breaks a run.
    }
  };

  const unsubscribe = deps.agent.subscribe((event) => {
    if (!('seq' in event)) return;
    switch (event.type) {
      case 'run.paused':
        if (event.payload.reason === 'limit' && event.payload.until !== undefined)
          schedule(event.runId, event.payload.until);
        break;
      case 'card.sent':
        if (event.payload.card.type === 'rateLimit') onCard(event.runId, event.payload.card);
        break;
      case 'run.completed':
      case 'run.failed':
      case 'run.cancelled':
        release(event.runId);
        break;
      default:
        break;
    }
  });

  return {
    async start() {
      const open = await deps.log.openRuns();
      if (!open.ok) return;
      for (const runId of open.value) {
        const events = await deps.log.read(runId);
        if (!events.ok) continue;
        const state = foldEvents(runId, events.value);
        if (state.status === 'paused' && state.limitWait) schedule(runId, state.limitWait.until);
      }
    },
    close() {
      closed = true;
      unsubscribe();
      for (const runId of [...scheduled.keys(), ...holds.keys()]) release(runId);
    },
  };
}
