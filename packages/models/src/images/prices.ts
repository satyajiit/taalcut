// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-image list prices for estimates (P3-B7, G8), by provider, the provider's model id and size, each with
 * its source and date (`_orch/p3/research/image-generation.md`, 2026-10-14). A provider's own billed figure
 * wins whenever the response has one (OpenRouter's `usage.cost`, OpenAI's token usage). Token-priced models
 * with no published per-image figure are flagged `estimated`, so the cost card says "about".
 */
import type { ImageEstimate, ImageRequest, ImageSize } from './image-types';

/** Bump with any change below; the cost eval reads it. */
export const IMAGE_PRICES_VERSION = '2026-10-14';

export interface ImagePriceRow {
  readonly provider: string;
  readonly model: string;
  readonly usd: Readonly<Record<ImageSize, number>>;
  readonly estimated: boolean;
  readonly source: string;
}

const OPENROUTER_ENDPOINTS = 'https://openrouter.ai/api/v1/images/models/{id}/endpoints (read 2026-10-14)';
const GOOGLE_PRICING = 'https://ai.google.dev/gemini-api/docs/pricing (2026-10-14)';
const XAI_CARD = 'https://docs.x.ai/developers/models/grok-imagine-image-2.0 (2026-10-14)';
const OPENAI_PRICING = 'https://developers.openai.com/api/docs/pricing (2026-10-14)';

/**
 * GPT Image 2.5 has no flat per-image price ($30 per million image output tokens). Until a recorded session
 * measures its tokens, the estimate is gpt-image-2's published 1024×1024 figure at the quality sent (low for
 * drafts, medium for finals): the same token rates, so the nearest published number.
 */
const GPT_IMAGE_ESTIMATE = { draft: 0.006, final: 0.053 } as const;
/** Nano Banana 2.1: 1,120 image tokens at 1K and 1,680 at 2K, $30 per million. */
const NANO_BANANA = { draft: 0.0336, final: 0.0504 } as const;
/** Nano Banana Pro: 1,120 tokens at 1K and 2K, $120 per million. */
const GEMINI_PRO_IMAGE = { draft: 0.134, final: 0.134 } as const;

export const IMAGE_PRICES: readonly ImagePriceRow[] = [
  {
    provider: 'openrouter',
    model: 'x-ai/grok-imagine-image-2.0',
    // low_1k for drafts, medium_2k for finals: the tiers the request asks for.
    usd: { draft: 0.04, final: 0.08 },
    estimated: false,
    source: OPENROUTER_ENDPOINTS,
  },
  {
    provider: 'openrouter',
    model: 'google/gemini-nano-banana-2.1',
    usd: NANO_BANANA,
    estimated: false,
    source: OPENROUTER_ENDPOINTS,
  },
  {
    provider: 'openrouter',
    model: 'google/gemini-3-pro-image',
    usd: GEMINI_PRO_IMAGE,
    estimated: false,
    source: OPENROUTER_ENDPOINTS,
  },
  ...['openai/gpt-image-2.5-flare', 'openai/gpt-image-2.5-sunburst', 'openai/gpt-image-2'].map(
    (model): ImagePriceRow => ({
      provider: 'openrouter',
      model,
      usd: GPT_IMAGE_ESTIMATE,
      estimated: true,
      source: OPENROUTER_ENDPOINTS,
    }),
  ),
  {
    provider: 'xai',
    model: 'grok-imagine-image-2.0',
    // The model card's flat price; a 2K still costs more on OpenRouter, which xAI's card doesn't show.
    usd: { draft: 0.04, final: 0.04 },
    estimated: false,
    source: XAI_CARD,
  },
  {
    provider: 'google',
    model: 'gemini-nano-banana-2.1',
    usd: NANO_BANANA,
    estimated: false,
    source: GOOGLE_PRICING,
  },
  {
    provider: 'google',
    model: 'gemini-3-pro-image',
    usd: GEMINI_PRO_IMAGE,
    estimated: false,
    source: GOOGLE_PRICING,
  },
  ...['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].map((model): ImagePriceRow => ({
    provider: 'openai',
    model,
    usd: GPT_IMAGE_ESTIMATE,
    estimated: true,
    source: OPENAI_PRICING,
  })),
];

/** OpenAI's GPT Image token rates (US$ per million), for a response that reports its usage. */
export const GPT_IMAGE_TOKEN_USD = { textInput: 5, imageOutput: 30 } as const;
/** Gemini image output, US$ per million tokens, by model. */
export const GEMINI_IMAGE_TOKEN_USD: Readonly<Record<string, number>> = {
  'gemini-nano-banana-2.1': 30,
  'gemini-3-pro-image': 120,
};

export function imagePrice(provider: string, model: string): ImagePriceRow | undefined {
  return IMAGE_PRICES.find((row) => row.provider === provider && row.model === model);
}

/** count × the per-image price at the size; null when no price is known. */
export function imageEstimate(
  provider: string,
  model: string,
  request: Pick<ImageRequest, 'size' | 'count'>,
): ImageEstimate | null {
  const row = imagePrice(provider, model);
  return row ? { usd: roundUsd(row.usd[request.size] * request.count), estimated: row.estimated } : null;
}

/** Money to the micro-dollar, so sums of per-image shares don't drift. */
export function roundUsd(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}
