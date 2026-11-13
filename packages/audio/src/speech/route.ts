// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Language routing (SPEC). The language decision (language-decision.ts) has already applied the floor: the slices
 * here are the languages it named. One language goes to its engine by name; several (mixed speech) to whisper's
 * `auto`, so a code-mixed clip isn't forced into one language; none (unclear) to `auto` too. Parakeet takes en, es
 * and pt; whisper the rest it knows. A language neither knows (Odia) never gets here: the transcript stage skips it.
 */
import { AUDIO_CONFIG, type HardwareTier } from '../config';
import { whisperCodeFor } from './whisper-languages';

export interface LanguageSlice {
  readonly language: string;
  readonly probability: number;
}

export interface DetectedLanguages {
  /** Set when the user already named the language: detection was skipped. */
  readonly language: string | null;
  readonly probability: number | null;
  readonly perSlice: readonly LanguageSlice[];
}

export interface RouteOptions {
  readonly tier: HardwareTier;
  readonly cloudFirst: boolean;
  /** Standing upload consent for `speech`, and the app is not in local-only mode. */
  readonly consent: boolean;
}

export type WhisperModelSize = 'small' | 'medium';

export interface TranscriptionRoute {
  readonly engine: 'scribe' | 'parakeet' | 'whisper';
  /** BCP 47 tag when one slice language covers the clip; otherwise the base code. */
  readonly language: string | null;
  readonly model: string;
  readonly whisperModel?: WhisperModelSize;
  /** Passed to whisper-cli `-l`: Whisper's code for the clip's one language, else `auto` (the CLI default is English). */
  readonly whisperLanguage?: string;
  readonly cloudSkipped?: 'no_consent';
}

const PARAKEET = new Set(['en', 'es', 'pt']);

/** `pt-BR` → `pt`. Whisper and Parakeet take the base code. */
export function spokenBase(tag: string): string {
  const base = tag.toLowerCase().split('-')[0];
  return base && base.length > 0 ? base : tag.toLowerCase();
}

export function whisperModelForTier(tier: HardwareTier): WhisperModelSize {
  return tier === 'minimum' ? 'small' : 'medium';
}

function dominant(codes: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  let best = codes[0] ?? 'en';
  let bestCount = -1;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function clipLanguage(slices: readonly LanguageSlice[]): string {
  const tags = slices.map((slice) => slice.language);
  if (tags.length > 0 && tags.every((tag) => tag === tags[0])) return tags[0]!;
  return dominant(slices.map((slice) => spokenBase(slice.language)));
}

function localRoute(detected: DetectedLanguages, tier: HardwareTier): TranscriptionRoute {
  const slices = detected.perSlice;
  const bases = slices.map((slice) => spokenBase(slice.language));
  const size = whisperModelForTier(tier);
  const whisperModelName =
    size === 'small' ? AUDIO_CONFIG.models.whisperSmall : AUDIO_CONFIG.models.whisperMedium;
  const one = new Set(bases).size === 1 ? bases[0] : undefined;
  const allParakeet = slices.length > 0 && bases.every((code) => PARAKEET.has(code));
  // LIB1-LANG: speech the decision found mixed (no one language, several named) isn't forced into one language;
  // Parakeet's own languages stay on Parakeet, which takes them together.
  if (detected.language === null && slices.length > 1 && !one && !allParakeet)
    return {
      engine: 'whisper',
      language: null,
      model: whisperModelName,
      whisperModel: size,
      whisperLanguage: 'auto',
    };
  // One language Whisper knows is named to it, not left to `auto` (which may hear another one).
  const code = one && one !== 'hi' && !PARAKEET.has(one) ? whisperCodeFor(one) : undefined;
  if (code)
    return {
      engine: 'whisper',
      language: clipLanguage(slices),
      model: whisperModelName,
      whisperModel: size,
      whisperLanguage: code,
    };
  if (bases.some((code) => code === 'hi')) {
    return {
      engine: 'whisper',
      language: 'hi',
      model: whisperModelName,
      whisperModel: size,
      whisperLanguage: 'hi',
    };
  }
  if (allParakeet) {
    return {
      engine: 'parakeet',
      language: clipLanguage(slices),
      model: AUDIO_CONFIG.models.parakeet,
    };
  }
  return {
    engine: 'whisper',
    language: detected.language,
    model: whisperModelName,
    whisperModel: size,
    whisperLanguage: 'auto',
  };
}

/**
 * Cloud-first with consent is Scribe for every language. Without consent the
 * local route still runs, and `cloudSkipped` tells the caption card why.
 */
export function routeTranscription(detected: DetectedLanguages, options: RouteOptions): TranscriptionRoute {
  const local = localRoute(detected, options.tier);
  if (!options.cloudFirst) return local;
  if (!options.consent) return { ...local, cloudSkipped: 'no_consent' };
  return {
    engine: 'scribe',
    language: detected.language ?? local.language,
    model: AUDIO_CONFIG.models.scribe,
  };
}
