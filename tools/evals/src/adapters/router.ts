// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shadow logs in, `routerReport` and `routerDecisions` out. No family is forced live:
 * `liveFamilies` stays empty unless the report recommends it.
 */
import { idSchema, newId } from '@taalcut/core';
import {
  newEvent,
  readEvent,
  routerDecisions,
  routerReport,
  type AgentEvent,
  type NewAgentEvent,
  type RouterGolden,
} from '@taalcut/agent';
import {
  loadRouterLabel,
  loadRouterLogFiles,
  type RouterLabel,
  type RouterPrediction,
} from '../router/schema';

export interface ShadowDecision {
  /** Absent on a timeout. */
  readonly choice?: string;
  readonly errorCode?: string;
  /** First domain-tool family, or `none` when the turn called none. */
  readonly main: string;
}

function toolCall(modelCallId: string, tool: string, meta: boolean) {
  return {
    toolCallId: idSchema<'ToolRun'>().parse(newId<'ToolRun'>()),
    modelCallId,
    modelToolCallId: 'call-1',
    tool,
    callName: tool.replace('.', '_'),
    meta,
    input: {},
    sideEffect: 'read' as const,
  };
}

function decisionEvents(decision: ShadowDecision): NewAgentEvent[] {
  const modelCallId = newId<'ModelCall'>();
  const route =
    decision.choice === undefined
      ? newEvent(
          'route.timeout',
          { modelCallId, afterMs: 2000, ...(decision.errorCode ? { errorCode: decision.errorCode } : {}) },
          1,
        )
      : newEvent(
          'route.shadow',
          {
            modelCallId,
            router: {
              choice: decision.choice,
              top3: [],
              confidence: 0.9,
              model: 'typesafe/jev-1.13.0',
              latencyMs: 300,
              costUsd: 0,
            },
          },
          1,
        );
  const responded = newEvent(
    'model.responded',
    {
      modelCallId,
      provider: 'stand-in',
      model: 'main-1',
      local: false,
      message: { role: 'assistant', parts: [], provider: 'stand-in', model: 'main-1' },
      text: '',
      toolCalls: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
      latencyMs: 1,
      stopReason: 'stop',
    },
    1,
  );
  const tool =
    decision.main === 'none'
      ? newEvent('tool.requested', toolCall(modelCallId, 'findTools', true), 1)
      : newEvent('tool.requested', toolCall(modelCallId, `${decision.main}.act`, false), 1);
  return [route, responded, tool];
}

/** One run's log, sealed through `readEvent` the way a stored envelope comes back. */
export function shadowLog(decisions: readonly ShadowDecision[]): AgentEvent[] {
  const runId = newId<'AgentRun'>();
  const fresh = decisions.flatMap((decision) => decisionEvents(decision));
  return fresh.map((event, seq) => {
    const read = readEvent({ ...event, runId, seq });
    if (read === undefined) throw new Error(`router event ${seq} did not parse`);
    return read;
  });
}

function readLog(events: readonly unknown[], name: string): AgentEvent[] {
  return events.map((raw, index) => {
    const read = readEvent(raw);
    if (read === undefined) throw new Error(`${name} event ${index} is not an agent envelope`);
    return read;
  });
}

function goldenOf(label: RouterLabel): RouterGolden | undefined {
  if (label.off === undefined || label.on === undefined) return undefined;
  return { off: label.off, on: label.on };
}

/** Calls `routerDecisions` and `routerReport`. Does not flip a family live on its own. */
export function predictRouter(
  logs: readonly (readonly AgentEvent[])[],
  label: RouterLabel,
): RouterPrediction {
  const golden = goldenOf(label);
  const report = routerReport(logs, golden, { id: label.caseId, now: () => 1 });
  const decided = logs.flatMap((events) => routerDecisions(events));
  if (decided.length !== report.agreement.n) {
    throw new Error(`routerDecisions counted ${decided.length}, routerReport counted ${report.agreement.n}`);
  }
  return {
    caseId: label.caseId,
    n: report.agreement.n,
    matches: report.agreement.matches,
    families: report.families.map((family) => ({
      family: family.family,
      n: family.n,
      matches: family.matches,
    })),
    // An off task with no on-run leaves the golden halves unmeasured (review M9): the scorer then fails both.
    tokens:
      report.tokens === null || report.unpaired.length > 0
        ? null
        : { full: report.tokens.full, routed: report.tokens.routed },
    flips: report.flips.length,
    measured: golden !== undefined && report.unpaired.length === 0,
  };
}

export function predictRouterDir(labelsDir: string): RouterPrediction[] {
  const label = loadRouterLabel(labelsDir);
  const logs = loadRouterLogFiles(labelsDir).map((file) => readLog(file.events, file.name));
  return [predictRouter(logs, label)];
}
