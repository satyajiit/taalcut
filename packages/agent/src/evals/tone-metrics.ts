// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Deterministic tone and verbosity measures of one reply (SPEC section 22): no model involved. Sentences,
 * emoji, exclamation marks, jargon the persona avoids (in the four v1 languages) and whether the reply is in
 * the user's language. The judge scores tone; these catch what a judge can miss (an emoji at
 * "professional", an English answer to a Hindi question).
 */
import type { ToneLanguage } from './tone-types';

/** Words SOUL.md says not to use unless the user does first ("clip", not "asset"). Lowercase. */
export const JARGON: Readonly<Record<ToneLanguage, readonly string[]>> = {
  en: ['bpm grid', 'asset', 'lufs', 'reframe to', 'b-roll', 'j-cut', 'l-cut', 'keyframe', 'codec', 'bitrate'],
  hi: ['बीपीएम ग्रिड', 'एसेट', 'लफ़्स', 'कोडेक', 'बिटरेट'],
  es: ['cuadrícula de bpm', 'asset', 'lufs', 'códec', 'tasa de bits', 'fotograma clave'],
  'pt-BR': ['grade de bpm', 'asset', 'lufs', 'codec', 'taxa de bits', 'quadro-chave'],
};

export interface ToneMetrics {
  readonly sentences: number;
  readonly words: number;
  readonly emoji: number;
  /** "!" and "¡". */
  readonly exclamations: number;
  /** Jargon from any of the four lists, as found. */
  readonly jargon: readonly string[];
  readonly language: ToneLanguage;
  readonly languageMatches: boolean;
}

const EMOJI = /\p{Extended_Pictographic}/gu;
const DEVANAGARI = /\p{Script=Devanagari}/gu;
const LETTER = /\p{L}/gu;

/** Common short words per Latin-script language, for a coarse guess of the reply's language. */
const words = (list: string) => new Set(list.split(' '));
const STOPWORDS: Readonly<Record<'en' | 'es' | 'pt-BR', ReadonlySet<string>>> = {
  en: words('the and is to of it you that in on with for your i'),
  es: words('el la los las de que y es en un una por con tu lo'),
  'pt-BR': words('o a os as de que e é em um uma com não do da'),
};

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

/** Sentences: runs of text ending in . ! ? । or the end, ignoring decimals like "21.4". */
export function sentenceCount(text: string): number {
  return text
    .replace(/(\d)\.(\d)/g, '$1$2')
    .split(/[.!?।]+(?:\s|$)|\n+/u)
    .filter((part) => /\p{L}/u.test(part)).length;
}

/** The reply's language: Devanagari script is Hindi; otherwise the best stopword match, English on a tie. */
export function detectLanguage(text: string): ToneLanguage {
  const letters = count(text, LETTER);
  if (letters > 0 && count(text, DEVANAGARI) / letters > 0.3) return 'hi';
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  let best: ToneLanguage = 'en';
  let bestScore = 0;
  for (const language of ['en', 'es', 'pt-BR'] as const) {
    const score = words.filter((word) => STOPWORDS[language].has(word)).length;
    if (score > bestScore) {
      best = language;
      bestScore = score;
    }
  }
  return best;
}

export function toneMetrics(text: string, expected: ToneLanguage): ToneMetrics {
  const lower = text.toLowerCase();
  const jargon = [...new Set(Object.values(JARGON).flat())].filter((term) => lower.includes(term));
  const language = detectLanguage(text);
  return {
    sentences: sentenceCount(text),
    words: (text.match(/[\p{L}\p{N}]+/gu) ?? []).length,
    emoji: count(text, EMOJI),
    exclamations: count(text, /[!¡]/g),
    jargon,
    language,
    languageMatches: language === expected,
  };
}
