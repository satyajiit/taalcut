// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * createRouteAdvisor (SPEC section 24): one `choice` question over `none` plus the families, as spike 04
 * measured, asked of models' Classifier (the `router` module's chain: TypeSafe Jev pinned, Clef-flash, then
 * the on-device rules router). The families' tool one-liners go only to on-device routers (`localHints`).
 * Jev and Clef are decision models: nothing they say reaches the user.
 */
import { ROUTER_SETTING, type RouterSetting } from '@taalcut/core';
import type { Classifier, ClassifyRequest } from '@taalcut/models';
import type { RouterAnswerLog } from '../phase3-events';
import { NONE_DESCRIPTION, NONE_FAMILY } from './families';
import {
  DEFAULT_ROUTER_TIMINGS,
  type RouteAdvisor,
  type RouteAsk,
  type RouteOutcome,
  type RouterTimings,
} from './router-port';

export const ROUTE_QUESTION_ID = 'family';
export const ROUTE_INSTRUCTIONS =
  'Which tool family should the next step of this creator request use, or none if no tool should run? ' +
  'Judge the message and the step. Do not fill tool arguments.';
const MAX_MESSAGE = 2_000;
const MAX_PREVIOUS = 500;

export interface RouteAdvisorDeps {
  readonly classifier: Classifier;
  /** core's ROUTER_SETTING as stored; a failed read is 'off'. */
  readonly setting: () => Promise<RouterSetting>;
  readonly timings?: Partial<RouterTimings>;
}

export function createRouteAdvisor(deps: RouteAdvisorDeps): RouteAdvisor {
  return {
    timings: { ...DEFAULT_ROUTER_TIMINGS, ...deps.timings },
    async setting() {
      try {
        return await deps.setting();
      } catch {
        // The router only saves tokens: when its setting can't be read, it stays off.
        return ROUTER_SETTING.defaultValue;
      }
    },
    async decide(ask) {
      const result = await deps.classifier.classify(routeRequest(ask));
      if (!result.ok) return { kind: 'failed', errorCode: result.error.code };
      const answer = result.value.answers[ROUTE_QUESTION_ID];
      if (answer?.type !== 'choice') return { kind: 'failed', errorCode: 'agent.router_no_answer' };
      const log: RouterAnswerLog = {
        choice: answer.choice,
        top3: Object.entries(answer.probabilities)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 3)
          .map(([option, probability]) => ({ option, probability })),
        confidence: answer.confidence,
        model: `${result.value.provider}/${result.value.model}`,
        latencyMs: result.value.latencyMs,
        costUsd: result.value.costUsd,
      };
      return { kind: 'answered', answer: log } satisfies RouteOutcome;
    },
  };
}

/** The classifier request for one decision. */
export function routeRequest(ask: RouteAsk): ClassifyRequest {
  const options: Record<string, string> = { [NONE_FAMILY]: NONE_DESCRIPTION };
  const hints: Record<string, string> = {};
  for (const family of ask.families) {
    options[family.id] = family.description;
    hints[family.id] = family.tools;
  }
  return {
    state: {
      message: ask.message.slice(0, MAX_MESSAGE),
      stepText: ask.stepText.slice(0, MAX_MESSAGE),
      turn: ask.turn,
      lastFamilies: [...ask.lastFamilies],
      ...(ask.previousMessage ? { previousMessage: ask.previousMessage.slice(0, MAX_PREVIOUS) } : {}),
    },
    questions: { [ROUTE_QUESTION_ID]: { type: 'choice', instructions: ROUTE_INSTRUCTIONS, options } },
    localHints: { [ROUTE_QUESTION_ID]: hints },
    signal: ask.signal,
    trace: ask.trace,
  };
}
