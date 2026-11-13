// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardOf } from '@taalcut/core';
import { RUN, T0, usd } from './fixtures-phase3-ids';

const sonnet = { provider: 'anthropic', model: 'claude-sonnet-5', local: false, estimate: usd(20_000) };
const onThisMac = { provider: 'taalcut', model: 'qwen3.5-4b', local: true };
const limit = (
  status: CardOf<'rateLimit'>['status'],
  reason: CardOf<'rateLimit'>['reason'],
  extra: Partial<CardOf<'rateLimit'>> & { readonly id?: string } = {},
): CardOf<'rateLimit'> => ({
  type: 'rateLimit',
  id: `limit-${status}-${reason}`,
  version: 1,
  runId: RUN,
  module: 'agent',
  reason,
  status,
  // CHATGPT_PROVIDER: the ChatGPT plan.
  from: { provider: 'openai-codex', model: 'gpt-5.2' },
  resetsAt: T0 + 12 * 60_000,
  options: [sonnet, onThisMac],
  // The run asks while it waits, and after a switch (Undo for this video, Keep using it).
  ...(status === 'waiting' || status === 'switched' ? { approvalId: `ap-limit-${status}-${reason}` } : {}),
  ...extra,
});

/** G8's rateLimit card: each status and reason, with and without a reset time, with 0, 1 and 6 other models. */
export const RATE_LIMIT_FIXTURES: Readonly<Record<string, CardOf<'rateLimit'>>> = {
  waitingRate: limit('waiting', 'rate'),
  waitingRateNoReset: limit('waiting', 'rate', { id: 'limit-waiting-rate-unknown', resetsAt: null }),
  waitingPlan: limit('waiting', 'plan', { options: [sonnet] }),
  waitingQuota: limit('waiting', 'quota', {
    from: { provider: 'openai', model: 'gpt-5.2' },
    resetsAt: null,
    options: [],
    billingUrl: 'https://platform.openai.com/settings/organization/billing',
  }),
  waitingQuotaNoBilling: limit('waiting', 'quota', {
    id: 'limit-waiting-quota-nolink',
    from: { provider: 'xai', model: 'grok-5' },
    resetsAt: null,
    options: [onThisMac],
  }),
  waitingSixModels: limit('waiting', 'rate', {
    id: 'limit-waiting-six',
    options: [
      { provider: 'google', model: 'gemini-3-flash', local: false, estimate: usd(4_000) },
      { provider: 'openrouter', model: 'deepseek-v4', local: false, estimate: usd(6_000) },
      { provider: 'xai', model: 'grok-5-fast', local: false, estimate: usd(9_000) },
      sonnet,
      { provider: 'anthropic', model: 'claude-opus-5', local: false, estimate: usd(110_000) },
      onThisMac,
    ],
  }),
  // Local only: never a paid model, so only this Mac's.
  localOnly: limit('waiting', 'rate', { id: 'limit-waiting-local', options: [onThisMac] }),
  switched: limit('switched', 'rate', { to: sonnet, extra: usd(20_000) }),
  switchedLocal: limit('switched', 'plan', { to: onThisMac }),
  switchedQuota: limit('switched', 'quota', {
    from: { provider: 'openai', model: 'gpt-5.2' },
    to: sonnet,
    extra: usd(35_000),
  }),
  resumed: limit('resumed', 'rate'),
  resumedNoTime: limit('resumed', 'plan', { resetsAt: null }),
  stopped: limit('stopped', 'quota', { resetsAt: null }),
  stoppedRate: limit('stopped', 'rate'),
};
