// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- the consent line is counsel's text in the speaker's language, compared word for word: never translated */

/**
 * The consent line the speaker reads aloud (P3-B6, audio SPEC P3.3), word for word as packages/audio's
 * voice/consent-lines.ts has it: the check compares the recording against those words, so the card shows the same
 * ones. DRAFT copy pending counsel (H6). When counsel's text lands, audio's file, this one and core's
 * VOICE_CONSENT_TERMS_VERSION change together; a card under other terms shows no line (it can't be the right one).
 */
import type { VOICE_CONSENT_TERMS_VERSION } from '@taalcut/core';

/** The terms these lines belong to (core's VOICE_CONSENT_TERMS_VERSION; a change there fails the build here). */
export const CONSENT_LINES_TERMS: typeof VOICE_CONSENT_TERMS_VERSION = '1';

const LINES: Readonly<Record<string, (name: string) => string>> = {
  en: (name) =>
    `My name is ${name}. This is my own voice, and I agree that Taalcut may make a copy of it from this recording for the videos I make.`,
  es: (name) =>
    `Me llamo ${name}. Esta es mi propia voz, y acepto que Taalcut haga una copia de ella a partir de esta grabación para los vídeos que yo haga.`,
  pt: (name) =>
    `Meu nome é ${name}. Esta é a minha própria voz, e eu concordo que o Taalcut faça uma cópia dela a partir desta gravação para os vídeos que eu fizer.`,
  hi: (name) =>
    `मेरा नाम ${name} है। यह मेरी अपनी आवाज़ है, और मैं सहमत हूँ कि Taalcut इस रिकॉर्डिंग से मेरे बनाए वीडियो के लिए इसकी एक कॉपी बना सकता है।`,
};

/** The line's language: the consent's base language when there is a line for it, else English (as audio does). */
export function consentLineLanguage(language: string): string {
  const base = language.split('-')[0] ?? language;
  return base in LINES ? base : 'en';
}

/** The line with the speaker's name in it; null under terms these lines aren't for. */
export function consentLine(termsVersion: string, language: string, speakerName: string): string | null {
  if (termsVersion !== CONSENT_LINES_TERMS) return null;
  const line = LINES[consentLineLanguage(language)];
  return line ? line(speakerName.trim()) : null;
}
