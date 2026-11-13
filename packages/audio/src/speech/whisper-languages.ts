// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The languages Whisper names and transcribes (whisper.cpp's `g_lang`, the multilingual models' 99 plus Cantonese),
 * by the code Whisper takes for `-l`. Odia isn't one of them: Whisper can't name it, and Taalcut doesn't ask it to
 * write Odia out (LIB1-LANG).
 */
export const WHISPER_LANGUAGES = [
  'en', 'zh', 'de', 'es', 'ru', 'ko', 'fr', 'ja', 'pt', 'tr', 'pl', 'ca', 'nl', 'ar', 'sv', 'it', 'id', 'hi', 'fi',
  'vi', 'he', 'uk', 'el', 'ms', 'cs', 'ro', 'da', 'hu', 'ta', 'no', 'th', 'ur', 'hr', 'bg', 'lt', 'la', 'mi', 'ml',
  'cy', 'sk', 'te', 'fa', 'lv', 'bn', 'sr', 'az', 'sl', 'kn', 'et', 'mk', 'br', 'eu', 'is', 'hy', 'ne', 'mn', 'bs',
  'kk', 'sq', 'sw', 'gl', 'mr', 'pa', 'si', 'km', 'sn', 'yo', 'so', 'af', 'oc', 'ka', 'be', 'tg', 'sd', 'gu', 'am',
  'yi', 'lo', 'uz', 'fo', 'ht', 'ps', 'tk', 'nn', 'mt', 'sa', 'lb', 'my', 'bo', 'tl', 'mg', 'as', 'tt', 'haw', 'ln',
  'ha', 'ba', 'jw', 'su', 'yue',
] as const; // prettier-ignore

const WHISPER = new Set<string>(WHISPER_LANGUAGES);

/** Whisper's codes that differ from BCP 47. */
const TO_BCP47: Readonly<Record<string, string>> = { jw: 'jv', iw: 'he', fil: 'tl' };
const FROM_BCP47: Readonly<Record<string, string>> = { jv: 'jw', fil: 'tl', nb: 'no' };

/** A Whisper code as a BCP 47 tag (`jw` → `jv`). */
export function fromWhisperCode(code: string): string {
  const lower = code.toLowerCase();
  return TO_BCP47[lower] ?? lower;
}

/** The code Whisper takes for a BCP 47 tag, or undefined when Whisper can't transcribe the language (Odia). */
export function whisperCodeFor(tag: string): string | undefined {
  const base = tag.toLowerCase().split('-')[0] ?? '';
  const code = FROM_BCP47[base] ?? base;
  return WHISPER.has(code) ? code : undefined;
}
