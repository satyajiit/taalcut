// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's ToolPolicy: settings checks, budgets and autonomy levels
 * (SPEC section 7). An approval is an event in the run log covering specific
 * tool call ids; the executor refuses destructive and external tools whose
 * 'allow' carries no approval id, so a bug here can't skip the user.
 */
import { newId, toolNeedsApproval, type AnyTool, type RunId } from '@taalcut/core';
import type {
  ToolAuthorizeRequest,
  ToolDecision,
  ToolDescriptor,
  ToolGateRequest,
  ToolPolicy,
} from '@taalcut/tools';
import { budgetBreach } from './budget';
import { consentGate, isUpload, type ConsentDeps } from './consent';
import { capApproval, checkProjectCap, cheaperChoices, type CostDeps } from './costs';
import { localOnlyRefusal, type LocalOnlyDeps } from './local-only/local-only';
import type { AutonomyLevel } from './events';
import { STALE_EXPORT_REASON } from './export-approvals';
import { approvalCardFor } from './result-cards';
import type { EventInput, RunLog } from './run-log';
import { approvalFor, type RunState } from './state';

/** Does this tool need the user's approval at this autonomy level? (SPEC section 7 table) */
export function needsApproval(
  tool: Pick<ToolDescriptor, 'sideEffect' | 'checkpoint'> & Partial<Pick<ToolDescriptor, 'alwaysAsk'>>,
  level: AutonomyLevel,
): boolean {
  // Destructive and external tools, and alwaysAsk ones (memory.remember, LRN1-MEM), ask at every level.
  if (toolNeedsApproval(tool)) return true;
  if (tool.checkpoint) return level !== 'autopilot';
  if (tool.sideEffect === 'write') return level === 'every-step';
  return false;
}

export interface PolicyDeps extends ConsentDeps {
  readonly runLog: (runId: RunId | undefined) => RunLog | undefined;
  readonly now: () => number;
  /** The project cap and prices (P2-X1). */
  readonly costs?: CostDeps;
  /** A tool's spec, for its own approval card. */
  readonly resolveSpec?: (name: string) => AnyTool | undefined;
  /** Local only now and which modules run on this Mac (P3-B10). Without it, the run's logged flag alone. */
  readonly localOnly?: LocalOnlyDeps;
}

export function createAgentPolicy(deps: PolicyDeps): ToolPolicy {
  return {
    checkPermission(request: ToolGateRequest): ToolDecision {
      const log = deps.runLog(request.runId);
      if (!log) return { kind: 'deny', reason: 'The tool was called outside an agent run.' };
      // Local only when the run started or now: a switch turned on mid-run applies to the next call.
      if (log.state.started?.localOnly || deps.localOnly?.now()) {
        const refused = localOnlyRefusal(request.tool.permission, deps.localOnly?.onDevice);
        if (refused) return { kind: 'deny', reason: refused };
      }
      return { kind: 'allow' };
    },

    async authorize(request: ToolAuthorizeRequest): Promise<ToolDecision> {
      const log = deps.runLog(request.runId);
      if (!log) return { kind: 'deny', reason: 'The tool was called outside an agent run.' };
      const budget = await budgetGate(log, request, deps.now());
      if (budget) return budget;
      const cap = await projectCapGate(deps, log, request);
      if (cap) return cap;
      // Sending the user's media to a cloud model asks for consent at every level, autopilot included.
      if (isUpload(request.tool)) return consentGate(deps, log, request, deps.localOnly?.now() === true);
      const level = log.state.started?.autonomy ?? 'before-render';
      if (!needsApproval(request.tool, level)) return { kind: 'allow' };
      const approval = approvalFor(log.state, request.callId, 'tool');
      if (approval?.status === 'granted') return { kind: 'allow', approvalId: approval.request.requestId };
      if (approval?.status === 'denied')
        return {
          kind: 'deny',
          reason: approval.deniedReason === 'stale' ? STALE_EXPORT_REASON : 'The user declined this step.',
        };
      if (approval) return { kind: 'defer', reason: 'Waiting for the user to approve.' };
      const covered = coveredCalls(log.state, request, level);
      const requestId = newId<'Approval'>();
      const spec = deps.resolveSpec?.(request.tool.name);
      const card = spec
        ? await approvalCardFor(log, spec, request.callId, request.input, requestId)
        : undefined;
      const requested = await log.append(
        [
          'approval.requested',
          {
            requestId,
            kind: 'tool',
            toolCallIds: covered,
            reason: request.tool.requiresApproval ? request.tool.sideEffect : level,
            ...(card ? { customCard: true } : {}),
          },
        ],
        ...(card
          ? [['card.sent', { card, approvalId: requestId, toolCallId: request.callId }] as EventInput]
          : []),
      );
      return requested.ok
        ? { kind: 'defer', reason: 'Asked the user to approve.' }
        : { kind: 'deny', reason: 'Could not record the approval request.' };
    },
  };
}

async function budgetGate(
  log: RunLog,
  request: ToolAuthorizeRequest,
  now: number,
): Promise<ToolDecision | undefined> {
  const estimate = request.estimate;
  // A free call's tokens (a model on this Mac) don't count against the budget (BRK1-MAKE).
  const paid = (estimate?.usd ?? 0) > 0;
  const breach = budgetBreach(
    log.state,
    { usd: estimate?.usd ?? 0, tokens: paid ? (estimate?.tokens ?? 0) : 0 },
    now,
  );
  if (!breach || !estimate) return undefined;
  const approval = approvalFor(log.state, request.callId, 'budget');
  if (approval?.status === 'granted') return undefined;
  if (approval?.status === 'denied') return { kind: 'deny', reason: 'The user chose not to go over budget.' };
  if (approval) return { kind: 'defer', reason: 'Waiting for the user to approve the cost.' };
  const requested = await log.append([
    'approval.requested',
    {
      requestId: newId<'Approval'>(),
      kind: 'budget',
      toolCallIds: [request.callId],
      reason: `${request.tool.name} would go over the ${breach.limit} budget`,
      limit: breach.limit,
      used: breach.used,
      max: breach.max,
      estimate: { usd: estimate.usd, tokens: estimate.tokens ?? 0 },
    },
  ]);
  return requested.ok
    ? { kind: 'defer', reason: 'Asked the user about the cost.' }
    : { kind: 'deny', reason: 'Could not record the budget request.' };
}

/**
 * The project cap before a tool with a cost estimate (SPEC section 14), and
 * the estimate itself when the call is paid work outside a skill (a skill's
 * estimate covers its own tools). Approving the cap lets nothing through by
 * itself: the call is checked again with the new cap or model.
 */
async function projectCapGate(
  deps: PolicyDeps,
  log: RunLog,
  request: ToolAuthorizeRequest,
): Promise<ToolDecision | undefined> {
  const usd = request.estimate?.usd ?? 0;
  const state = log.state;
  if (usd <= 0) return undefined;
  const projectId = state.flow?.projectId ?? state.started?.projectId;
  const cap = await checkProjectCap(deps.costs ?? {}, projectId, usd);
  const prior = approvalFor(state, request.callId, 'budget');
  if (cap.over && projectId) {
    if (prior?.request.limit === 'projectCap' && prior.status === 'pending')
      return { kind: 'defer', reason: 'Waiting for the user about the project cap.' };
    if (prior?.request.limit === 'projectCap' && prior.status === 'denied')
      return { kind: 'deny', reason: 'The user stopped at the project cap.' };
    const module = (request.tool.permission.cloudModules?.[0] ?? 'agent') as never;
    const tokens = request.estimate?.tokens ?? 0;
    const { event } = capApproval({
      toolCallIds: [request.callId],
      projectId,
      labelKey: `tools.${request.tool.name}`,
      reason: `${request.tool.name} would go over the project's cap`,
      estimate: { usd, tokens },
      cap: cap.cap,
      cheaper: cheaperChoices(
        deps.costs?.prices,
        module,
        { inputTokens: tokens, outputTokens: 0 },
        cap.cap.usd - cap.cap.spentUsd,
      ),
    });
    const asked = await log.append(event);
    return asked.ok
      ? { kind: 'defer', reason: 'Asked the user about the project cap.' }
      : { kind: 'deny', reason: 'Could not record the budget request.' };
  }
  const step = state.plan?.[state.stepIndex];
  const recorded = Object.values(state.estimates).some((e) => e.recorded.toolCallId === request.callId);
  if (!step?.skill && !recorded) {
    const module = request.tool.permission.cloudModules?.[0] ?? 'agent';
    const price = deps.costs?.prices?.price(module as never);
    await log.append([
      'estimate.recorded',
      {
        estimateId: newId<'Estimate'>(),
        toolCallId: request.callId,
        labelKey: `tools.${request.tool.name}`,
        tool: request.tool.name,
        estimate: { usd, tokens: request.estimate?.tokens ?? 0 },
        lines: [
          {
            module: module as never,
            provider: price?.provider ?? 'unknown',
            model: price?.model ?? 'unknown',
            local: price?.local ?? false,
            tokens: request.estimate?.tokens ?? 0,
            usd,
            // "2 images", not "0 tokens", on the cost card (review M8).
            ...(request.estimate?.billed ? { billed: request.estimate.billed } : {}),
          },
        ],
        ...(cap.cap ? { cap: cap.cap } : {}),
      },
    ]);
  }
  return undefined;
}

/**
 * At "Ask me at every step", one card covers every write call in the model
 * turn. Everything else is approved call by call.
 */
function coveredCalls(state: RunState, request: ToolAuthorizeRequest, level: AutonomyLevel): string[] {
  const call = state.toolCalls[request.callId];
  if (level !== 'every-step' || request.tool.sideEffect !== 'write' || !call) return [request.callId];
  const sameTurn = state.toolCallOrder
    .map((id) => state.toolCalls[id]!)
    .filter(
      (c) =>
        c.requested.modelCallId === call.requested.modelCallId &&
        c.requested.sideEffect === 'write' &&
        !c.outcome &&
        !approvalFor(state, c.requested.toolCallId, 'tool'),
    )
    .map((c) => c.requested.toolCallId);
  return sameTurn.includes(request.callId) ? sameTurn : [request.callId, ...sameTurn];
}
