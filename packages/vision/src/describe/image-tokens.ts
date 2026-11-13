// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How many input tokens an image costs, by provider family, from each
 * provider's published rules. An estimate for budgets (G8): the real usage
 * comes back from the provider after the call and is what gets charged.
 *
 * - OpenAI (tile models): fit in 2048×2048, shrink so the short side is at
 *   most 768, then 85 + 170 per 512 px tile.
 * - Anthropic: long side at most 1568 px, about width × height / 750 tokens,
 *   capped near 1600.
 * - Google Gemini: 258 tokens up to 384×384, else 258 per 768 px tile.
 * - Anything else: width × height / 750 (the Anthropic rule, a fair middle).
 */

export type ImageTokenFamily = 'openai' | 'anthropic' | 'google' | 'other';

export function imageTokenFamily(provider: string, model: string): ImageTokenFamily {
  const id = `${provider}/${model}`.toLowerCase();
  if (/anthropic|claude/.test(id)) return 'anthropic';
  if (/google|gemini|gemma/.test(id)) return 'google';
  if (/openai|azure|(^|\/)gpt-|(^|\/)o\d/.test(id)) return 'openai';
  return 'other';
}

/** Scales (w, h) down, never up, so that it fits inside maxW × maxH. */
function fit(w: number, h: number, maxW: number, maxH: number): [number, number] {
  const scale = Math.min(1, maxW / w, maxH / h);
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}

export function estimateImageTokens(provider: string, model: string, width: number, height: number): number {
  switch (imageTokenFamily(provider, model)) {
    case 'openai': {
      const [w1, h1] = fit(width, height, 2048, 2048);
      const short = Math.min(w1, h1);
      const [w, h] = short > 768 ? fit(w1, h1, (w1 * 768) / short, (h1 * 768) / short) : [w1, h1];
      return 85 + 170 * Math.ceil(w / 512) * Math.ceil(h / 512);
    }
    case 'anthropic': {
      const [w, h] = fit(width, height, 1568, 1568);
      return Math.min(1600, Math.ceil((w * h) / 750));
    }
    case 'google':
      if (width <= 384 && height <= 384) return 258;
      return 258 * Math.ceil(width / 768) * Math.ceil(height / 768);
    case 'other':
      return Math.ceil((width * height) / 750);
  }
}
