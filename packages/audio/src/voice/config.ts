// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Voiceover fitting and placement (SPEC P3.3, P3.4). */
export const VOICE_CONFIG = {
  version: 1,
  /** Words a second by language (base subtag); refitted on generated lines once they exist. */
  rates: { en: 2.7, es: 3.0, pt: 2.9, hi: 2.5 } as Readonly<Record<string, number>>,
  defaultRate: 2.7,
  /** A line more than this share over its span comes back with a suggested length. */
  overTolerance: 0.15,
  /** A line may run into this share of the next slot when that slot has no line. */
  spillMax: 0.5,
  /** Without a beat map the onset sits this far into the slot. */
  leadInMs: 120,
  /** Lines keep at least this much silence between them. */
  gapMinMs: 150,
  /** A generated line may be time-compressed by at most this much (Eleven v4 has no speed setting). */
  maxCompress: 0.08,
  /** A final take this much longer than its draft is re-placed, never squeezed. */
  finalLongerThanDraft: 0.08,
  /** The script's characters per request (Eleven v4 turbo's cap isn't published; SPEC P3.1). */
  maxLineChars: 500,
  maxLines: 40,
  /** Words must cover this share of the script's graphemes (the skill's verify). */
  coverage: 0.98,
} as const;

export function wordsPerSecond(language: string): number {
  const base = language.split('-')[0] ?? language;
  return VOICE_CONFIG.rates[base] ?? VOICE_CONFIG.defaultRate;
}
