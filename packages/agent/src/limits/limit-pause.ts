// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A model limit meets a run (G8, platform request §24). When every option of a module is limited, the model
 * call fails with the last one's error: the run pauses with an approval of kind 'rateLimit' and a rateLimit
 * card offering wait, switch or stop (limit-answer.ts). A wait sleeps until the limit lifts: the gate before
 * every model turn pauses the run again until then (a timer or a restart resumes it), then says it resumed.
 * A switch runs the module on the chosen model for the rest of the run. Every switch the model client makes
 * on its own posts a `switched` card.
 */
import {
  newId,
  ok,
  USAGE_LIMIT_KINDS,
  type AsyncResult,
  type ModelModuleId,
  type TaalcutError,
  type UsageLimitKind,
} from '@taalcut/core';
import { limitOfError, type ModelEvent } from '@taalcut/models';
import type { RunContext } from '../context';
import type { EventInput } from '../run-log';
import type { RunState } from '../run-state';
import { limitOptions, movedCard, rateLimitCard, turnUsd, type RateLimitCard } from './limit-cards';

const LIMIT_CODES: ReadonlySet<string> = new Set([
  'models.rate_limited',
  'models.quota_exceeded',
  'models.plan_required',
]);

export function isLimitError(error: TaalcutError): boolean {
  return LIMIT_CODES.has(error.code);
}

/** The model a rateLimit card's "switch" chose for this module, for the rest of the run. */
export function limitTarget(
  state: RunState,
  module: string,
): { provider: string; model: string } | undefined {
  return state.modelOverrides?.[module];
}

const tokensFor = (ctx: RunContext, estimate: { readonly tokens: number }) => {
  const outputTokens = ctx.settings.expectedOutputTokens;
  return { inputTokens: Math.max(0, estimate.tokens - outputTokens), outputTokens };
};

/**
 * Before a model turn: a run waiting for a limit pauses again until `until` (resumed by the follower's timer,
 * or after a restart); once it has passed, the card says it resumed and the turn goes ahead.
 */
export async function limitGate(ctx: RunContext): Promise<AsyncResult<'paused'> | undefined> {
  const wait = ctx.log.state.limitWait;
  if (!wait) return undefined;
  if (ctx.now() < wait.until) {
    const paused = await ctx.log.append([
      'run.paused',
      { reason: 'limit', requestIds: [], until: wait.until },
    ]);
    return paused.ok ? ok('paused') : paused;
  }
  const card = cardOf(ctx.log.state, wait.requestId);
  const resumed = await ctx.log.append(
    ['limit.resumed', { requestId: wait.requestId }],
    ...(card ? [['card.sent', { card: movedCard(card, 'resumed') }] as EventInput] : []),
  );
  return resumed.ok ? undefined : resumed;
}

/** The model call failed on a limit every option met: model.failed, the question, its card, the pause. */
export async function pauseAtLimit(
  ctx: RunContext,
  module: ModelModuleId,
  modelCallId: string,
  error: TaalcutError,
  estimate: { readonly tokens: number },
): AsyncResult<'paused'> {
  const state = ctx.log.state;
  const failedOn = failedModel(error, state, module);
  const limit = limitOfError(error, module, failedOn, ctx.now());
  const kind: UsageLimitKind = limit?.kind ?? 'rate';
  const tokens = tokensFor(ctx, estimate);
  const options = limitOptions({
    prices: ctx.phase2.prices,
    module,
    from: failedOn,
    limited: ctx.phase3.limits?.current() ?? [],
    localOnly: state.started?.localOnly ?? false,
    tokens,
  });
  const requestId = newId<'Approval'>();
  const cardId = `rateLimit:${requestId}`;
  const resetsAt = limit?.resetsAt ?? null;
  const card = rateLimitCard(ctx.log.runId, {
    id: cardId,
    module,
    kind,
    status: 'waiting',
    from: failedOn,
    resetsAt,
    approvalId: requestId,
    options,
    ...(limit?.billingUrl ? { billingUrl: limit.billingUrl } : {}),
  });
  const paused = await ctx.log.append(
    ['model.failed', { modelCallId, error }],
    [
      'approval.requested',
      {
        requestId,
        kind: 'rateLimit',
        toolCallIds: [],
        reason: `Every ${module} model met a ${kind} limit`,
        customCard: true,
        rateLimit: {
          module,
          provider: failedOn.provider,
          model: failedOn.model,
          kind,
          resetsAt,
          ...(limit?.billingUrl ? { billingUrl: limit.billingUrl } : {}),
          cardId,
          options,
        },
      },
    ],
    ['card.sent', { card, approvalId: requestId }],
    ['run.paused', { reason: 'approval', requestIds: [requestId] }],
  );
  return paused.ok ? ok('paused') : paused;
}

/**
 * The model client moved down the chain because a model met a limit: a `switched` card says so (logged while
 * the call streams, so history shows it). Other fallbacks (a provider down) post nothing.
 */
export async function noteClientSwitch(
  ctx: RunContext,
  module: ModelModuleId,
  modelCallId: string,
  event: Extract<ModelEvent, { type: 'fallback' }>,
  estimate: { readonly tokens: number },
): Promise<void> {
  const limit = limitOfError(event.reason, module, event.from, ctx.now());
  if (!limit || !(USAGE_LIMIT_KINDS as readonly string[]).includes(limit.kind)) return;
  const tokens = tokensFor(ctx, estimate);
  const toUsd = turnUsd(ctx.phase2.prices, module, event.to, tokens);
  const fromUsd = turnUsd(ctx.phase2.prices, module, event.from, tokens);
  const local = ctx.phase2.prices
    ?.options(module)
    .find((o) => o.provider === event.to.provider && o.model === event.to.model)?.local;
  const card = rateLimitCard(ctx.log.runId, {
    id: `rateLimit:${modelCallId}:${event.from.provider}/${event.from.model}`,
    module,
    kind: limit.kind,
    status: 'switched',
    from: event.from,
    to: { provider: event.to.provider, model: event.to.model, local: local ?? false },
    resetsAt: limit.resetsAt,
    options: [],
    ...(limit.billingUrl ? { billingUrl: limit.billingUrl } : {}),
    ...(toUsd !== undefined && fromUsd !== undefined ? { extraUsd: toUsd - fromUsd } : {}),
  });
  // A card that can't be logged is only a missing notice: the call goes on.
  await ctx.log.append(['card.sent', { card }]);
}

/** The rateLimit card a request posted, as last sent. */
export function cardOf(state: RunState, requestId: string): RateLimitCard | undefined {
  const cardId = state.approvals[requestId]?.request.rateLimit?.cardId;
  const card = cardId ? state.cards[cardId] : undefined;
  return card?.type === 'rateLimit' ? card : undefined;
}

/** The model the call failed on: the error's own, else the chain's override or the module's price entry. */
function failedModel(error: TaalcutError, state: RunState, module: ModelModuleId) {
  const params = error.params ?? {};
  const override = limitTarget(state, module);
  const provider = typeof params.provider === 'string' ? params.provider : (override?.provider ?? 'unknown');
  const model = typeof params.model === 'string' ? params.model : (override?.model ?? 'unknown');
  return { provider, model };
}
