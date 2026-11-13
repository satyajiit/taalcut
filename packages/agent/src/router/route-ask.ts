// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the router is asked on one act turn, from the folded state: the message, the step, the families on
 * offer (a skill step's own subset only), the families of the latest calls. And the run's router mode, as
 * run.started logged it, so a run keeps the mode it started with and replay agrees.
 */
import type { ProjectId, RouterSetting } from '@taalcut/core';
import type { RunContext } from '../context';
import type { EventPayloads } from '../events';
import type { EventInput } from '../run-log';
import type { RunState } from '../run-state';
import { subsetCatalogue } from '../skill-step';
import { stepWithheld } from '../skill-withheld';
import { familyOfCall, NONE_FAMILY, routeFamilies } from './families';
import type { RouteAsk, RouteOutcome } from './router-port';

const LAST_FAMILIES = 5;

/** The router setting the run started with; absent (Phase 2 logs, or the router off) reads 'off'. */
export function runRouterSetting(state: RunState): RouterSetting | undefined {
  return state.started?.router;
}

export function routerMode(state: RunState): RouterSetting['mode'] {
  return runRouterSetting(state)?.mode ?? 'off';
}

export function routeAsk(ctx: RunContext, modelCallId: string, signal: AbortSignal): RouteAsk {
  const state = ctx.log.state;
  const step = state.plan?.[state.stepIndex];
  const skill = step?.skill ? ctx.skills.get(step.skill) : undefined;
  const entries = skill ? subsetCatalogue(ctx, skill, stepWithheld(skill, step)) : ctx.registry.catalogue();
  const projectId = (state.flow?.projectId ?? state.started?.projectId) as ProjectId | undefined;
  const previous = state.started?.history?.turns.at(-1)?.user;
  return {
    message: state.started?.message ?? '',
    stepText: step?.text || (skill ? `${skill.id}: ${skill.description}` : ''),
    turn: step?.turns ?? 0,
    lastFamilies: lastFamilies(ctx, state),
    ...(previous ? { previousMessage: previous } : {}),
    families: routeFamilies(entries),
    signal,
    trace: { runId: ctx.log.runId, spanId: modelCallId, ...(projectId ? { projectId } : {}) },
  };
}

function lastFamilies(ctx: RunContext, state: RunState): string[] {
  return state.toolCallOrder
    .map((id) => state.toolCalls[id])
    .flatMap((call) =>
      call && !call.requested.meta ? [familyOfCall(ctx.registry, call.requested.tool)] : [],
    )
    .filter((family) => family !== NONE_FAMILY)
    .slice(-LAST_FAMILIES);
}

/** The log event for one decision: the router's answer, or a timeout (with the error when it failed). */
export function decisionEvent(
  state: RunState,
  modelCallId: string,
  outcome: RouteOutcome | undefined,
  afterMs: number,
): EventInput {
  const stepId = state.plan?.[state.stepIndex]?.id;
  const where = { ...(stepId ? { stepId } : {}), modelCallId };
  if (outcome?.kind === 'answered') return ['route.shadow', { ...where, router: outcome.answer }];
  const payload: EventPayloads['route.timeout'] = {
    ...where,
    afterMs: Math.max(0, Math.round(afterMs)),
    ...(outcome?.kind === 'failed' ? { errorCode: outcome.errorCode } : {}),
  };
  return ['route.timeout', payload];
}

/** Waits for a promise at most `ms`; undefined when the time ran out. */
export function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}
