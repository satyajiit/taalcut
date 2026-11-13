// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * G8's log types: what a run decided when a model limit met it. The pause itself is an approval of kind
 * 'rateLimit' (its `rateLimit` field says which limit) and a `rateLimit` card; these record the answer's
 * effect, so a resumed run (or one after a restart) waits, switches or goes on from the log alone.
 */
import type { UsageLimitKind } from '@taalcut/core';

export interface LimitModelRef {
  provider: string;
  model: string;
  local: boolean;
  /** What the turn would cost on it, when priced. */
  usd?: number;
}

/** The limit a paused run met, on its approval.requested (kind 'rateLimit'). */
export interface RateLimitAsk {
  /** The model module whose every option was limited, e.g. 'agent'. */
  module: string;
  provider: string;
  model: string;
  kind: UsageLimitKind;
  /** Epoch ms; null when the provider didn't say. */
  resetsAt: number | null;
  billingUrl?: string;
  /** The rateLimit card's id. */
  cardId: string;
  /** The module's other options the card offered, cheapest first, local last. */
  options: LimitModelRef[];
}

export interface LimitEventPayloads {
  /** "Wait": the run sleeps until `until`, then goes on (a timer, or the next resume after a restart). */
  'limit.waiting': { requestId: string; until: number };
  /** The wait is over: the run goes on with the same model chain. */
  'limit.resumed': { requestId: string };
  /** "Switch": the module runs on `to` for the rest of this run only. */
  'limit.switched': { requestId: string; module: string; to: { provider: string; model: string } };
}

export const LIMIT_EVENT_VERSIONS: Readonly<Record<keyof LimitEventPayloads, number>> = {
  'limit.waiting': 1,
  'limit.resumed': 1,
  'limit.switched': 1,
};
