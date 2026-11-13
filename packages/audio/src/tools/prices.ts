// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * List prices the paid tools and the Voice director estimate with (G8): @taalcut/models' ElevenLabs price table,
 * handed in by the agent root, since audio imports nothing but core and media. A tool's estimate runs before the
 * call and sees only its input, so where the cost depends on the stored timeline it uses the bound below and says
 * so in `basis`; the skill's estimate reads the timeline and is exact.
 */
import type { ToolCostEstimate, VoiceQuality } from '@taalcut/core';

export interface GenerationPrices {
  /** US$ per character of a voice line at this quality. */
  voicePerCharacter(quality: VoiceQuality): number;
  /** US$ per second of generated music (an estimate: the provider publishes no fixed rate). */
  musicPerSecond(): number;
  /** US$ per second of a generated sound effect. */
  sfxPerSecond(): number;
}

export const ESTIMATE_BOUNDS = {
  /** A voiceover's characters when the estimate can't read them: about three minutes of speech. */
  voiceoverCharacters: 3000,
  /** A track's seconds when the estimate can't read the timeline: three minutes and the 2 s tail. */
  musicSeconds: 182,
  /** Seconds of a generated hit (sfx.generateHit asks for this length). */
  hitSeconds: 2,
} as const;

/** Rounded to a millionth of a dollar, like core's Money micros. */
const toMicros = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;

// Each says what ElevenLabs bills (characters, seconds), so the cost card shows that, not "0 tokens" (review M8).

export function voiceEstimate(
  prices: GenerationPrices,
  characters: number,
  quality: VoiceQuality,
  basis: string,
): ToolCostEstimate {
  return {
    usd: toMicros(characters * prices.voicePerCharacter(quality)),
    billed: { unit: 'character', quantity: characters },
    basis,
  };
}

export function musicEstimate(prices: GenerationPrices, seconds: number, basis: string): ToolCostEstimate {
  return {
    usd: toMicros(seconds * prices.musicPerSecond()),
    billed: { unit: 'second', quantity: seconds },
    basis,
  };
}

export function sfxEstimate(prices: GenerationPrices, seconds: number, basis: string): ToolCostEstimate {
  return {
    usd: toMicros(seconds * prices.sfxPerSecond()),
    billed: { unit: 'second', quantity: seconds },
    basis,
  };
}
