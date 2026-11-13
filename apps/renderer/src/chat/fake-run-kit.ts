// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Card, ChatEffort, ChatEvent, ReasoningLevel } from '@taalcut/core';
import type { Beat } from './fake-script';

/** The fake chat's small parts: waiting, a run's followers, and how an answer settles its card. */

/** Matches one selected occurrence, keeping older event-type-only holds on the first match. */
export function holdWhen(spec?: string): (event: ChatEvent) => boolean {
  const [type, occurrence = '1'] = spec?.split(':') ?? [];
  let matches = 0;
  return (event) => event.type === type && ++matches === Number(occurrence);
}

/** Resolves after `ms`, or as soon as `signal` aborts. Never rejects. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** A run's events for one follower: pushed as they happen, read as an async iterable. */
export function eventQueue(signal: AbortSignal) {
  const queued: ChatEvent[] = [];
  let ended = signal.aborted;
  let wake: (() => void) | undefined;
  const poke = () => {
    wake?.();
    wake = undefined;
  };
  const end = () => {
    ended = true;
    poke();
  };
  signal.addEventListener('abort', end, { once: true });
  return {
    push(event: ChatEvent) {
      queued.push(event);
      poke();
    },
    end,
    async *events(): AsyncGenerator<ChatEvent> {
      for (;;) {
        const event = queued.shift();
        if (event) yield event;
        else if (ended) return;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}
export type Follower = ReturnType<typeof eventQueue>;

export const settle = (card: Card, decision: 'approve' | 'deny'): Card => {
  const status = decision === 'approve' ? ('approved' as const) : ('denied' as const);
  if (card.type === 'approval' || card.type === 'consent') return { ...card, status };
  if (card.type === 'costEstimate' && card.version === 1) return { ...card, requiresApproval: false };
  // UX4: the review page's Export and Not now, as the agent settles them (a fake render needs no wait).
  if (card.type === 'exportApproval')
    return { ...card, status: decision === 'approve' ? 'exported' : 'declined' };
  return card;
};

/**
 * As the agent does: the run starts with the level the message was sent with, kept in its history. The exact
 * level (UX3-AGT) wins over an effort when both come.
 */
export function withLevel(
  beats: Beat[],
  picked: { readonly reasoning?: ReasoningLevel | undefined; readonly effort?: ChatEffort | undefined },
): Beat[] {
  const level = picked.reasoning
    ? { reasoning: picked.reasoning }
    : picked.effort
      ? { effort: picked.effort }
      : null;
  if (!level) return beats;
  return beats.map((beat) => ({
    ...beat,
    event: (at) => {
      const event = beat.event(at);
      return event.type === 'agent.runStarted'
        ? { ...event, payload: { ...event.payload, ...level } }
        : event;
    },
  }));
}
