// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Mode `on` (SPEC section 24): before an act turn the router has 800 ms to answer. A family set `live`
 * (honoured only while a passing report is recorded in the setting's `gate`) chosen with confidence ≥ 0.6
 * loads only that family's best five tools for the step, plus the pseudo-tools; `none` with confidence ≥ 0.8
 * and `noneLive` offers no domain tools. Any other family, a late answer or an error gives the turn the full
 * catalogue at once (the per-family kill switch). The model leaving the routed family (findTools, or a domain
 * tool outside it) is a `route.override`.
 */
import type { RouterSetting } from '@taalcut/core';
import type { ToolCall } from '@taalcut/models';
import type { ToolRegistry } from '@taalcut/tools';
import type { RunContext } from '../context';
import { FIND_TOOL } from '../meta-tools';
import type { EventInput } from '../run-log';
import type { RunState } from '../run-state';
import { familyOfCall, mainFamily, NONE_FAMILY } from './families';
import { decisionEvent, routeAsk, routerMode, runRouterSetting, within } from './route-ask';
import { stepAllows } from '../skill-withheld';
import { recordDecision } from './router-telemetry';
import type { RouteOutcome } from './router-port';

export const LIVE_FAMILY_CONFIDENCE = 0.6;
export const LIVE_NONE_CONFIDENCE = 0.8;
const LIVE_TOOLS = 5;

/** Whether a family's routing is live: set `live` and the gate passed. 'none' follows `noneLive`. */
export function familyLive(setting: RouterSetting | undefined, family: string): boolean {
  if (!setting || setting.mode !== 'on' || setting.gate === null) return false;
  if (family === NONE_FAMILY) return setting.noneLive;
  return setting.families[family] === 'live';
}

/** Mode `on`: the decision for the coming act turn, and the routed tools when it is live. */
export async function routeBeforeTurn(ctx: RunContext, modelCallId: string): Promise<EventInput[]> {
  const advisor = ctx.phase3.router;
  const state = ctx.log.state;
  if (!advisor || routerMode(state) !== 'on') return [];
  const controller = new AbortController();
  const signal = AbortSignal.any([ctx.signal, controller.signal]);
  const startedAt = ctx.now();
  const decided = advisor.decide(routeAsk(ctx, modelCallId, signal));
  const outcome: RouteOutcome | undefined = advisor.recorded
    ? await decided
    : await within(decided, advisor.timings.liveMs);
  if (!outcome) controller.abort();
  const events: EventInput[] = [decisionEvent(state, modelCallId, outcome, ctx.now() - startedAt)];
  if (outcome?.kind !== 'answered') return events;
  const { choice, confidence } = outcome.answer;
  const floor = choice === NONE_FAMILY ? LIVE_NONE_CONFIDENCE : LIVE_FAMILY_CONFIDENCE;
  const step = state.plan?.[state.stepIndex];
  if (!step || confidence < floor || !familyLive(runRouterSetting(state), choice)) return events;
  const tools = choice === NONE_FAMILY ? [] : familyTools(ctx, step.text, choice);
  events.push(['route.chosen', { stepId: step.id, query: step.text, tools, by: 'router', family: choice }]);
  return events;
}

/** The family's best tools for the step text, within a skill step's subset. */
function familyTools(ctx: RunContext, query: string, family: string): string[] {
  const state = ctx.log.state;
  const step = state.plan?.[state.stepIndex];
  const skill = step?.skill ? ctx.skills.get(step.skill) : undefined;
  const allowed = skill ? stepAllows(ctx, skill, step) : () => true;
  const found = ctx.registry
    .search(query, { families: [family], limit: LIVE_TOOLS * 2 })
    .map((hit) => hit.name)
    .filter(allowed);
  const rest = ctx.registry
    .catalogue({ families: [family] })
    .map((entry) => entry.name)
    .filter((name) => allowed(name) && !found.includes(name));
  return [...found, ...rest].slice(0, LIVE_TOOLS);
}

/** Which loaded tools a turn may be offered: all, unless a live route narrowed this turn to one family. */
export function routedAllows(
  state: RunState,
  registry: Pick<ToolRegistry, 'resolve'>,
): (name: string) => boolean {
  const routed = state.liveRoute;
  if (routed === undefined) return () => true;
  return (name) => routed !== NONE_FAMILY && familyOfCall(registry, name) === routed;
}

/** After an act turn in mode `on`: the override (if the model left the routed family) and telemetry. */
export function afterLiveTurn(
  ctx: RunContext,
  modelCallId: string,
  calls: readonly ToolCall[],
): EventInput[] {
  const state = ctx.log.state;
  if (!ctx.phase3.router || routerMode(state) !== 'on') return [];
  const record = state.routes.findLast((r) => r.modelCallId === modelCallId && r.kind !== 'override');
  const main = mainFamily(ctx.registry, calls);
  if (record?.kind === 'shadow') recordDecision(ctx, record.router, 'answered', main);
  else if (record?.kind === 'timeout')
    recordDecision(ctx, undefined, record.errorCode ? 'error' : 'timeout', main);
  const routed = state.liveRoute;
  if (routed === undefined) return [];
  const left = calls.find(
    (call) =>
      call.name === FIND_TOOL ||
      (familyOfCall(ctx.registry, call.name) !== NONE_FAMILY &&
        familyOfCall(ctx.registry, call.name) !== routed),
  );
  if (!left) return [];
  const stepId = state.plan?.[state.stepIndex]?.id;
  return [['route.override', { ...(stepId ? { stepId } : {}), modelCallId, routed, called: left.name }]];
}
