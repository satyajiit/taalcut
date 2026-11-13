// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ElevenLabs list prices (SPEC P3.2): PRD 8.2 as of 2026-10-12, each with its source. ElevenLabs bills plans in
 * credits; the cost eval checks this table against the account's usage page by hand. Music has no published fixed
 * rate, so its price is an estimate and says so.
 */
import { ELEVENLABS_MODELS } from './config';

export interface ElevenLabsPrice {
  readonly model: string;
  readonly unit: 'character' | 'second';
  readonly usdPerUnit: number;
  /** No fixed rate is published: the cost card shows "about". */
  readonly estimated: boolean;
  readonly source: string;
  readonly asOf: string;
}

const API_PRICING = 'https://elevenlabs.io/pricing/api';
const AS_OF = '2026-10-12';

export const ELEVENLABS_PRICES: readonly ElevenLabsPrice[] = [
  // US$0.08 per 1,000 characters.
  {
    model: ELEVENLABS_MODELS.final,
    unit: 'character',
    usdPerUnit: 0.08 / 1000,
    estimated: false,
    source: API_PRICING,
    asOf: AS_OF,
  },
  // US$0.04 per 1,000 characters.
  {
    model: ELEVENLABS_MODELS.draft,
    unit: 'character',
    usdPerUnit: 0.04 / 1000,
    estimated: false,
    source: API_PRICING,
    asOf: AS_OF,
  },
  // US$0.12 per minute; the provider's own credit maths disagree, so the character-cost header is recorded too.
  {
    model: ELEVENLABS_MODELS.soundEffect,
    unit: 'second',
    usdPerUnit: 0.12 / 60,
    estimated: true,
    source: 'https://elevenlabs.io/docs/overview/capabilities/sound-effects',
    asOf: AS_OF,
  },
  // PRD 8.2's US$0.15 per minute: credits per generation vary by plan.
  {
    model: ELEVENLABS_MODELS.music,
    unit: 'second',
    usdPerUnit: 0.15 / 60,
    estimated: true,
    source: 'https://elevenlabs.io/music-terms',
    asOf: AS_OF,
  },
];

const BY_MODEL: ReadonlyMap<string, ElevenLabsPrice> = new Map(
  ELEVENLABS_PRICES.map((price) => [price.model, price]),
);

export function elevenLabsPrice(model: string): ElevenLabsPrice | undefined {
  return BY_MODEL.get(model);
}

/** US$ for `quantity` units of the model; 0 for a model with no listed price. */
export function elevenLabsCost(model: string, quantity: number): number {
  return (elevenLabsPrice(model)?.usdPerUnit ?? 0) * quantity;
}
