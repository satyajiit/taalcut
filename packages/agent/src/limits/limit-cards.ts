// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The rateLimit card (G8, core's rateLimitCardSchema): a switch the model client made on its own, or a pause
 * until a limit lifts with the module's other options. Re-sent under the same id as it moves on (waiting →
 * resumed, switched or stopped). Money in micro-USD.
 */
import type { CardOf, ModelModuleId, RunId, UsageLimit, UsageLimitKind } from '@taalcut/core';
import { estimateUsd, type PriceLookup } from '@taalcut/models';
import { usd } from '../chat-cards';
import type { LimitModelRef } from './limit-events';

export type RateLimitCard = CardOf<'rateLimit'>;
type CardStatus = RateLimitCard['status'];

/** At most this many options on a card (core's schema). */
const MAX_OPTIONS = 6;

export interface LimitCardInput {
  readonly id: string;
  readonly module: string;
  readonly kind: UsageLimitKind;
  readonly status: CardStatus;
  readonly from: { readonly provider: string; readonly model: string };
  readonly to?: LimitModelRef;
  readonly resetsAt: number | null;
  readonly approvalId?: string;
  readonly options: readonly LimitModelRef[];
  readonly billingUrl?: string;
  /** What the switch costs on top of the limited model, when both are priced. */
  readonly extraUsd?: number;
}

export function rateLimitCard(runId: RunId, input: LimitCardInput): RateLimitCard {
  return {
    type: 'rateLimit',
    id: input.id,
    version: 1,
    runId,
    module: input.module as ModelModuleId,
    reason: input.kind,
    status: input.status,
    from: { provider: input.from.provider, model: input.from.model },
    ...(input.to
      ? { to: { provider: input.to.provider, model: input.to.model, local: input.to.local } }
      : {}),
    resetsAt: input.resetsAt,
    ...(input.extraUsd !== undefined && input.extraUsd > 0 ? { extra: usd(input.extraUsd) } : {}),
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
    options: input.options.slice(0, MAX_OPTIONS).map((o) => ({
      provider: o.provider,
      model: o.model,
      local: o.local,
      ...(o.usd !== undefined ? { estimate: usd(o.usd) } : {}),
    })),
    ...(input.billingUrl ? { billingUrl: input.billingUrl } : {}),
  };
}

/** The card moved on: a new status (and the model switched to), no longer asking. */
export function movedCard(card: RateLimitCard, status: CardStatus, to?: LimitModelRef): RateLimitCard {
  const { approvalId: _asked, ...rest } = card;
  return {
    ...rest,
    status,
    ...(to ? { to: { provider: to.provider, model: to.model, local: to.local } } : {}),
  };
}

export interface OptionsInput {
  readonly prices: PriceLookup | undefined;
  readonly module: ModelModuleId;
  /** The limited model (left out). */
  readonly from: { readonly provider: string; readonly model: string };
  /** Limits other models of the module met too (left out). */
  readonly limited: readonly UsageLimit[];
  /** Local only: paid options are never offered. */
  readonly localOnly: boolean;
  readonly tokens: { readonly inputTokens: number; readonly outputTokens: number };
}

/** The module's other configured options, priced for the turn: cheapest first, local last. */
export function limitOptions(input: OptionsInput): LimitModelRef[] {
  const isLimited = (provider: string, model: string) =>
    input.limited.some((l) => l.provider === provider && (l.model === undefined || l.model === model));
  return (input.prices?.options(input.module) ?? [])
    .filter((o) => !(o.provider === input.from.provider && o.model === input.from.model))
    .filter((o) => !isLimited(o.provider, o.model))
    .filter((o) => o.local || !input.localOnly)
    .map((o) => ({
      provider: o.provider,
      model: o.model,
      local: o.local,
      usd: o.local ? 0 : estimateUsd(o, input.tokens),
    }))
    .sort((a, b) => Number(a.local) - Number(b.local) || (a.usd ?? 0) - (b.usd ?? 0))
    .slice(0, MAX_OPTIONS);
}

/** What the turn would cost on a model, when the module's prices list it. */
export function turnUsd(
  prices: PriceLookup | undefined,
  module: ModelModuleId,
  model: { readonly provider: string; readonly model: string },
  tokens: OptionsInput['tokens'],
): number | undefined {
  const priced = prices
    ?.options(module)
    .find((o) => o.provider === model.provider && o.model === model.model);
  if (!priced) return undefined;
  return priced.local ? 0 : estimateUsd(priced, tokens);
}
