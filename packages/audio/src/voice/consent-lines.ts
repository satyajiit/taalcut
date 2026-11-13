// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The consent line a speaker reads aloud before their own voice may be cloned (SPEC P3.3, PRD 10.2), per
 * language. DRAFT copy, pending counsel (H6): when counsel's text lands, change it here and in the consent card
 * together and bump core's VOICE_CONSENT_TERMS_VERSION, so older consents stop counting. The card shows the same
 * words the check compares against.
 */
import { VOICE_CONSENT_TERMS_VERSION } from '@taalcut/core';

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

export const CONSENT_LINE_TERMS = VOICE_CONSENT_TERMS_VERSION;

/** The line in the speaker's language (its base subtag), English when there is none for it. */
export function consentLine(language: string, speakerName: string): string {
  const base = language.split('-')[0] ?? language;
  const line = LINES[base] ?? LINES.en;
  return line ? line(speakerName.trim()) : speakerName;
}

export function hasConsentLine(language: string): boolean {
  return (language.split('-')[0] ?? language) in LINES;
}
