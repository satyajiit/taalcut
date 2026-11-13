// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shadow mode (SPEC section 24): the router is asked in parallel with the main model's call and never
 * changes it, so it adds no latency. Its answer is logged (`route.shadow`) together with the main model's
 * response when it came first; a router still thinking then, or past its 2 s cap, or failing, is logged as
 * `route.timeout` and counts as a disagreement in the report (a router slower than the model it would steer
 * could not have saved anything). Agreement is never asked of a model: the report folds it from the log.
 */
import type { ToolCall } from '@taalcut/models';
import type { RunContext } from '../context';
import type { EventInput } from '../run-log';
import { mainFamily } from './families';
import { decisionEvent, routeAsk, routerMode } from './route-ask';
import { recordDecision } from './router-telemetry';
import type { RouteOutcome } from './router-port';

export interface ShadowRoute {
  /** The decision's log event, once the main model has answered with these calls. */
  settle(calls: readonly ToolCall[]): Promise<EventInput[]>;
  /** The main call failed or was cancelled: the router's answer has nothing to compare with. */
  abort(): void;
}

/** Starts the router beside an act turn's model call, in shadow mode only. */
export function startShadow(ctx: RunContext, modelCallId: string): ShadowRoute | undefined {
  const advisor = ctx.phase3.router;
  if (!advisor || routerMode(ctx.log.state) !== 'shadow') return undefined;
  const controller = new AbortController();
  const signal = AbortSignal.any([ctx.signal, controller.signal]);
  const startedAt = ctx.now();
  let outcome: RouteOutcome | undefined;
  const decided = advisor.decide(routeAsk(ctx, modelCallId, signal)).then(
    (value) => {
      outcome = value;
    },
    () => {
      outcome = { kind: 'failed', errorCode: 'agent.router_failed' };
    },
  );
  const timer = setTimeout(() => controller.abort(), advisor.timings.shadowMs);
  return {
    async settle(calls) {
      // A logged answer (replay) is final now; a live one gets one tick to land, never more.
      await (advisor.recorded ? decided : nextTick());
      clearTimeout(timer);
      const late = outcome === undefined || (outcome.kind === 'failed' && controller.signal.aborted);
      if (outcome === undefined) controller.abort();
      const final: RouteOutcome | undefined = late ? undefined : outcome;
      const afterMs = Math.min(ctx.now() - startedAt, advisor.timings.shadowMs);
      const main = mainFamily(ctx.registry, calls);
      if (final?.kind === 'answered') recordDecision(ctx, final.answer, 'answered', main);
      else recordDecision(ctx, undefined, final?.kind === 'failed' ? 'error' : 'timeout', main);
      return [decisionEvent(ctx.log.state, modelCallId, final, afterMs)];
    },
    abort() {
      clearTimeout(timer);
      controller.abort();
    },
  };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
