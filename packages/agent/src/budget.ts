// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Budgets (G8 base): per-run limits on tokens, money and active wall-clock
 * time. Checked before every model call and, through the tool policy, before
 * every tool that declares a cost estimate. Going over stops the run with a
 * cost-estimate card instead of spending.
 *
 * BRK1-MAKE: the token limit counts paid tokens only (`usage.paidTokens`): a
 * model turn that ran off this Mac, or a tool call that cost money. Tokens on
 * this Mac are free, so they never stop a run with "Spend about $0.00?".
 *
 * FIX-RUN: a plan the person signed in with (ChatGPT) is free per token too, and the wall clock only counts once
 * the run spends money or paid tokens: a run that costs nothing never stops on a budget card. The turn limits
 * (SPEC section 35) and the text-loop guard stop a runaway, paid or not.
 */
import type { BudgetLimit } from './events';
import type { ModelCostEstimate, ModelCostEstimator } from './ports';
import type { RunState } from './state';

/** Characters per token for the rough prompt estimate. */
const CHARS_PER_TOKEN = 4;

export interface BudgetBreach {
  readonly limit: BudgetLimit;
  readonly used: number;
  readonly max: number;
}

/**
 * Prices tokens at what this run has paid so far for model calls, or at
 * `usdPerMillionTokens` before the first call (default US$5, a mid-range
 * cloud model). Local models report US$0 and so estimate US$0 once seen.
 */
export function createDefaultCostEstimator(
  modelUsage: () => { tokens: number; usd: number },
  options: { usdPerMillionTokens?: number } = {},
): ModelCostEstimator {
  const fallbackRate = (options.usdPerMillionTokens ?? 5) / 1_000_000;
  return {
    estimate({ promptChars, expectedOutputTokens }): ModelCostEstimate {
      const tokens = Math.ceil(promptChars / CHARS_PER_TOKEN) + expectedOutputTokens;
      const spent = modelUsage();
      const rate = spent.tokens > 0 ? spent.usd / spent.tokens : fallbackRate;
      return { tokens, usd: tokens * rate };
    },
  };
}

/**
 * The first limit that `extra` would break, or undefined. Wall clock counts time since the last event, and only
 * once something is paid. `extra`'s tokens are the next call's paid tokens: none for a call that costs nothing.
 */
export function budgetBreach(
  state: RunState,
  extra: { readonly tokens?: number; readonly usd?: number },
  now: number,
): BudgetBreach | undefined {
  const { budget, usage } = state;
  if (budget.maxTokens !== undefined && usage.paidTokens + (extra.tokens ?? 0) > budget.maxTokens) {
    return { limit: 'tokens', used: usage.paidTokens, max: budget.maxTokens };
  }
  if (budget.maxUsd !== undefined && usage.usd + (extra.usd ?? 0) > budget.maxUsd + 1e-12) {
    return { limit: 'usd', used: usage.usd, max: budget.maxUsd };
  }
  const active = usage.activeMs + Math.max(0, now - state.lastAt);
  const paid = usage.usd > 0 || usage.paidTokens > 0 || (extra.usd ?? 0) > 0 || (extra.tokens ?? 0) > 0;
  if (budget.maxWallClockMs !== undefined && paid && active > budget.maxWallClockMs) {
    return { limit: 'wallClock', used: active, max: budget.maxWallClockMs };
  }
  return undefined;
}
