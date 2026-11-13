// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The consent check on an in-app recording (SPEC P3.3): the first 20 s are transcribed on this Mac (never the
 * cloud) and compared with the consent line: normalised tokens, token-level similarity at least
 * VOICE_CONSENT_PHRASE_MATCH, and the speaker's name present. A miss is `audio.consent_mismatch` with what was
 * heard (shown to the speaker); nothing uploads.
 */
import { err, ok, VOICE_CONSENT_PHRASE_MATCH, type AsyncResult } from '@taalcut/core';
import { consentLine } from './consent-lines';
import { ConsentMismatch } from './errors';

/** Local speech-to-text of a recording's start (whisper or Parakeet on this Mac). */
export interface LocalTranscriber {
  transcribe(
    path: string,
    options: { readonly language: string; readonly maxMs: number; readonly signal?: AbortSignal },
  ): AsyncResult<string>;
}

export const CONSENT_LISTEN_MS = 20_000;

/** Lowercase NFC words without punctuation, by Intl.Segmenter in the language. */
export function consentTokens(text: string, language: string): string[] {
  const segmenter = new Intl.Segmenter(language, { granularity: 'word' });
  const tokens: string[] = [];
  for (const s of segmenter.segment(text.normalize('NFC').toLocaleLowerCase(language)))
    if (s.isWordLike) tokens.push(s.segment);
  return tokens;
}

/** 1 − token edit distance / the longer length. */
export function tokenSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost));
    }
    previous = row;
  }
  return 1 - (previous[b.length] ?? 0) / Math.max(a.length, b.length);
}

export interface ConsentCheck {
  readonly phraseMatch: number;
  readonly heard: string;
}

/**
 * Compares what was heard with the consent line. The heard text is matched against the line's length of tokens
 * from its start, since the recording goes on reading after the line.
 */
export function matchConsent(
  heard: string,
  language: string,
  speakerName: string,
): ConsentCheck & { readonly ok: boolean } {
  const expected = consentTokens(consentLine(language, speakerName), language);
  const said = consentTokens(heard, language).slice(0, expected.length + 3);
  const phraseMatch = Math.round(tokenSimilarity(said.slice(0, expected.length), expected) * 1000) / 1000;
  const name = consentTokens(speakerName, language);
  const named = name.every((token) => said.includes(token));
  return { phraseMatch, heard: heard.slice(0, 300), ok: named && phraseMatch >= VOICE_CONSENT_PHRASE_MATCH };
}

export async function checkConsentRecording(
  transcriber: LocalTranscriber,
  input: {
    readonly path: string;
    readonly language: string;
    readonly speakerName: string;
    readonly signal?: AbortSignal;
  },
): AsyncResult<ConsentCheck> {
  const heard = await transcriber.transcribe(input.path, {
    language: input.language,
    maxMs: CONSENT_LISTEN_MS,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!heard.ok) return heard;
  const match = matchConsent(heard.value, input.language, input.speakerName);
  if (!match.ok)
    return err(ConsentMismatch({ heard: match.heard }, { detail: `phrase match ${match.phraseMatch}` }));
  return ok({ phraseMatch: match.phraseMatch, heard: match.heard });
}
