// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The list prices audio's paid tools and the Voice director estimate with: the same ElevenLabs table models bills
 * with (packages/models SPEC P3.2).
 */
import type { GenerationPrices } from '@taalcut/audio';
import { ELEVENLABS_MODELS, elevenLabsPrice } from '@taalcut/models';

const usdPer = (model: string) => elevenLabsPrice(model)?.usdPerUnit ?? 0;

/** models' ElevenLabs list prices, per character of speech and per second of music or sound. */
export const generationPrices: GenerationPrices = {
  voicePerCharacter: (quality) =>
    usdPer(quality === 'final' ? ELEVENLABS_MODELS.final : ELEVENLABS_MODELS.draft),
  musicPerSecond: () => usdPer(ELEVENLABS_MODELS.music),
  sfxPerSecond: () => usdPer(ELEVENLABS_MODELS.soundEffect),
};
