// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The second pass of `audio.identifyLanguage` (LIB1-LANG): when Whisper isn't sure of a language the Indian-language
 * identifier can't name, the identifier hears the same voice, one piece per phrase (merged up to 15 s), and the
 * language decision weighs both with the person's languages as the prior. The pieces are read from the PCM the job
 * already holds; nothing is decoded again.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import { msToFrame, readPcmChunks, type SpeechPcm } from '../asset-audio/wav-file';
import type { Span } from '../cleanup/segments';
import { INDIC_LID, voicePieces, type IndicLid } from '../speech/indic-lid';
import {
  decideLanguage,
  identifierNames,
  LANGUAGE_DECISION,
  type IdentifiedPiece,
  type LanguageDecision,
  type LanguageScore,
} from '../speech/language-decision';
import { fromWhisperCode } from '../speech/whisper-languages';
import type { WhisperLanguageGuess } from '../whisper/decoder';

/** At most this many pieces are heard: 30 s of voice is two to a few pieces; a phrase-by-phrase talker has more. */
const MAX_PIECES = 6;
/** And this many of the clip's later sound, for a mix. */
export const MAX_LATER_PIECES = 3;

export interface CascadeResult {
  readonly decision: LanguageDecision;
  readonly whisper: readonly LanguageScore[];
  /** What the identifier heard, each piece's three likeliest languages; absent when it didn't run. */
  readonly pieces?: readonly {
    startMs: number;
    endMs: number;
    top: readonly LanguageScore[];
    /** Of the clip's later sound (counts toward a mix only). */
    later?: true;
  }[];
}

/** Whisper's guess as BCP 47 scores, most likely first. */
export function whisperScores(guess: WhisperLanguageGuess): LanguageScore[] {
  const scores = guess.distribution?.length ? guess.distribution : [guess];
  return scores.map((score) => ({
    language: fromWhisperCode(score.language),
    probability: score.probability,
  }));
}

async function samplesOf(pcm: SpeechPcm, span: Span, signal: AbortSignal): Promise<Float32Array> {
  const range = { startFrame: msToFrame(span.startMs), endFrame: msToFrame(span.endMs) };
  const out = new Float32Array(Math.max(0, range.endFrame - range.startFrame));
  let at = 0;
  for await (const chunk of readPcmChunks(pcm, range, INDIC_LID.windowSamples, signal)) {
    out.set(chunk.subarray(0, out.length - at), at);
    at += chunk.length;
  }
  return out.subarray(0, Math.min(at, out.length));
}

/** The identifier's pieces of the window's voice. A piece it can't hear (too short, or a failed run) is left out. */
async function hearPieces(
  identifier: IndicLid,
  pcm: SpeechPcm,
  spans: readonly Span[],
  signal: AbortSignal,
  log?: (message: string) => void,
): AsyncResult<IdentifiedPiece[]> {
  const pieces: IdentifiedPiece[] = [];
  for (const piece of spans) {
    const samples = await samplesOf(pcm, piece, signal);
    if (samples.length < INDIC_LID.minSamples) continue;
    const scores = await identifier.identify(samples, signal);
    if (!scores.ok) {
      if (scores.error.code === 'core.cancelled') return scores;
      log?.(
        `[audio] the Indian-language identifier failed on a piece: ${scores.error.detail ?? scores.error.code}`,
      );
      continue;
    }
    pieces.push({ ...piece, scores: scores.value });
  }
  return ok(pieces);
}

export interface CascadeInput {
  readonly guess: WhisperLanguageGuess;
  readonly pcm: SpeechPcm;
  readonly window: Span;
  readonly spans?: readonly Span[] | undefined;
  /** The clip's later sound (laterPieces): heard for a mix only. */
  readonly later?: readonly Span[] | undefined;
  readonly spoken: readonly string[];
  readonly identifier?: IndicLid | undefined;
  readonly signal: AbortSignal;
  readonly log?: (message: string) => void;
}

/** Whisper's answer, then the identifier's when it is needed, then the decision. */
export async function identifyCascade(input: CascadeInput): AsyncResult<CascadeResult> {
  const whisper = whisperScores(input.guess);
  const heard = whisper[0];
  const foreign =
    heard && !identifierNames(heard.language) && heard.probability >= LANGUAGE_DECISION.foreignFloor;
  if (!input.identifier || foreign)
    return ok({ decision: decideLanguage({ whisper, spoken: input.spoken }), whisper });
  const near = voicePieces(input.spans, input.window).slice(0, MAX_PIECES);
  const pieces = await hearPieces(input.identifier, input.pcm, near, input.signal, input.log);
  if (!pieces.ok) return pieces;
  const far = (input.later ?? []).slice(0, MAX_LATER_PIECES);
  const later =
    far.length > 0 ? await hearPieces(input.identifier, input.pcm, far, input.signal, input.log) : ok([]);
  if (!later.ok) return later;
  const summary = (piece: IdentifiedPiece) => ({
    startMs: piece.startMs,
    endMs: piece.endMs,
    top: piece.scores.slice(0, 3).map((s) => ({ language: s.language, probability: round(s.probability) })),
  });
  return ok({
    decision: decideLanguage({ whisper, pieces: pieces.value, later: later.value, spoken: input.spoken }),
    whisper,
    pieces: [
      ...pieces.value.map(summary),
      ...later.value.map((piece) => ({ ...summary(piece), later: true as const })),
    ],
  });
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
