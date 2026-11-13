// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Replay never calls the router (SPEC section 24): the advisor it runs with answers each decision from the
 * log, in order (a replay makes the same turns in the same order, under new call ids), and reports the
 * setting the run started with.
 */
import { ROUTER_SETTING } from '@taalcut/core';
import type { AgentEvent } from '../events';
import type { Phase3Deps } from '../phase3-deps';
import { DEFAULT_ROUTER_TIMINGS, type RouteAdvisor, type RouteOutcome } from './router-port';

export function recordedRouteAdvisor(events: readonly AgentEvent[]): RouteAdvisor {
  const started = events.find((e) => e.type === 'run.started');
  const setting = (started?.type === 'run.started' && started.payload.router) || ROUTER_SETTING.defaultValue;
  const outcomes: RouteOutcome[] = events.flatMap((event): RouteOutcome[] => {
    if (event.type === 'route.shadow') return [{ kind: 'answered', answer: event.payload.router }];
    if (event.type === 'route.timeout')
      return [
        event.payload.errorCode
          ? { kind: 'failed', errorCode: event.payload.errorCode }
          : { kind: 'timeout' },
      ];
    return [];
  });
  return {
    timings: DEFAULT_ROUTER_TIMINGS,
    recorded: true,
    setting: async () => setting,
    // More decisions than the run made means the replay diverged; the tool sequence check says so.
    decide: async () => outcomes.shift() ?? { kind: 'failed', errorCode: 'agent.router_replay_exhausted' },
  };
}

/** A replay's Phase 3 deps: the router answers from the log whenever the run had one. */
export function withLoggedRouter(phase3: Phase3Deps, events: readonly AgentEvent[]): Phase3Deps {
  const { router: _live, ...rest } = phase3;
  const logged = events.some((e) => e.type === 'run.started' && e.payload.router !== undefined);
  return logged ? { ...rest, router: recordedRouteAdvisor(events) } : rest;
}
