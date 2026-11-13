// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * List prices of the router's cloud decision models, US$ per million input tokens (output is free on both),
 * as checked on 2026-10-14 (`_orch/p3/research/router-and-soul.md`). pi-ai's catalogue has Jev at US$0 (1.1.0
 * and 1.4.0) and 1.1.0 had Clef-flash at its old US$0.09, so the router prices its own rows from this table.
 */

export interface RouterPrice {
  readonly usdPerMillionInput: number;
  /** Hosted context in tokens (state plus questions). */
  readonly contextTokens: number;
  readonly source: string;
  readonly checkedOn: string;
}

export const ROUTER_PRICES: Readonly<Record<string, RouterPrice>> = {
  'typesafe/jev-1.13.0': {
    usdPerMillionInput: 0.042,
    contextTokens: 64_000,
    source: 'https://docs.typesafe.ai/models.md',
    checkedOn: '2026-10-14',
  },
  'typesafe/jev-latest': {
    usdPerMillionInput: 0.042,
    contextTokens: 64_000,
    source: 'https://docs.typesafe.ai/models.md',
    checkedOn: '2026-10-14',
  },
  'cloudflare-workers-ai/@cf/cloudflare/clef-flash': {
    usdPerMillionInput: 0.038,
    contextTokens: 24_576,
    source: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    checkedOn: '2026-10-14',
  },
  'cloudflare-workers-ai/@cf/cloudflare/clef': {
    usdPerMillionInput: 0.24,
    contextTokens: 65_536,
    source: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    checkedOn: '2026-10-14',
  },
};

/** Clef-flash's hosted window is 24,576 tokens: a state over this many tokens skips it (models SPEC P3.5). */
export const CLEF_FLASH_MAX_STATE_TOKENS = 20_000;

export function routerPrice(provider: string, model: string): RouterPrice | undefined {
  return ROUTER_PRICES[`${provider}/${model}`];
}

export function routerCostUsd(price: RouterPrice | undefined, inputTokens: number): number {
  return price ? (inputTokens * price.usdPerMillionInput) / 1_000_000 : 0;
}
