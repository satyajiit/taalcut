// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which language a clip's speech is in, from what the identifiers heard (LIB1-LANG), pure:
 *
 * 1. A language the person chose wins.
 * 2. Whisper tiny heard the voice window. When it is sure of a language the Indian-language identifier can't name
 *    (Spanish, Vietnamese…), Whisper decides.
 * 3. Otherwise the Indian-language identifier (Anuvani-LID, calibrated) decides, from its pieces of voice: pieces that
 *    are each sure of a different language, each a real share of the speech, make the clip mixed ("Hindi and
 *    English"), counting pieces of the clip's later sound too; else the pieces together name one language when they clear the floor. When they don't, Whisper's
 *    answer stands if it clears its own floor and the identifier also ranks it near the top.
 * 4. Without the identifier, Whisper decides alone, against its floor.
 *
 * Below the floor the clip is `unclear`: speech, no language named. The languages the person speaks are a prior:
 * each one's probability is multiplied by `priorWeight` before the floor is applied, so a close call leans their
 * way, and a clear answer for another language still wins.
 */
import type { SpokenLanguageOutcome } from '@taalcut/core';
import { isIndianLanguage, languageBase } from '@taalcut/core';

export interface LanguageScore {
  /** BCP 47. */
  readonly language: string;
  readonly probability: number;
}

/** One piece of voice the Indian-language identifier heard: every label's probability (a softmax). */
export interface IdentifiedPiece {
  readonly startMs: number;
  readonly endMs: number;
  readonly scores: readonly LanguageScore[];
}

export interface LanguageEvidence {
  /** Whisper's distribution over its languages, most likely first (the CLI gives only the first). */
  readonly whisper?: readonly LanguageScore[] | undefined;
  /** The Indian-language identifier's pieces; absent when it didn't run. */
  readonly pieces?: readonly IdentifiedPiece[] | undefined;
  /**
   * Pieces of the clip's later sound, past the voice window (its non-silent stretches; voice not checked). They
   * count toward a mix only, never toward the one language: a stretch of music there mustn't name the clip.
   */
  readonly later?: readonly IdentifiedPiece[] | undefined;
  /** The languages the person speaks (BCP 47). */
  readonly spoken: readonly string[];
  /** The language the person chose for this clip. */
  readonly chosen?: string | null | undefined;
}

export interface LanguageDecisionConfig {
  /** The identifier's confidence (after the prior) under which a clip is unclear. */
  readonly floor: number;
  /** Whisper's, when it decides. */
  readonly whisperFloor: number;
  /** Whisper's confidence in a language the identifier can't name, over which Whisper decides. */
  readonly foreignFloor: number;
  /** What a language the person speaks is multiplied by. */
  readonly priorWeight: number;
  /** The share of the voting speech a language needs to count in a mix. */
  readonly mixShare: number;
  /** Pieces shorter than this don't vote on a mix (the identifier is weak under about 2 s). */
  readonly minPieceMs: number;
  /** How far down the identifier's list Whisper's answer may sit to stand when the identifier is unsure. */
  readonly agreeRank: number;
  /**
   * Whisper's confidence in English over which English stands unless the identifier is surer of another language:
   * the identifier's English is Indian English, and it hears other accents weakly (as Telugu, Gujarati…).
   */
  readonly englishFloor: number;
}

/** Tuned on the LIB1 language eval (tools/evals/src/language, report in _orch/lib1/reports/lang.md). */
export const LANGUAGE_DECISION: LanguageDecisionConfig = {
  floor: 0.75,
  whisperFloor: 0.8,
  foreignFloor: 0.5,
  priorWeight: 2,
  mixShare: 0.25,
  minPieceMs: 2000,
  agreeRank: 3,
  englishFloor: 0.9,
};

export type DecisionSource = 'chosen' | 'identifier' | 'whisper' | 'none';

export interface LanguageDecision extends SpokenLanguageOutcome {
  /** Which evidence decided: for the log and the eval. */
  readonly source: DecisionSource;
}

/** The identifier names the Indian languages and English. */
export function identifierNames(tag: string): boolean {
  return isIndianLanguage(tag) || languageBase(tag) === 'en';
}

const sorted = (scores: readonly LanguageScore[]) =>
  [...scores].sort((a, b) => b.probability - a.probability);

/**
 * The scores with the prior applied, normalised. What the list leaves out (Whisper names only its likelier
 * languages, the CLI only one) keeps its weight in the total, so one named language isn't made certain.
 */
export function withPrior(
  scores: readonly LanguageScore[],
  spoken: readonly string[],
  weight: number,
): LanguageScore[] {
  const bases = new Set(spoken.map(languageBase));
  const weighted = scores.map((s) => ({
    language: s.language,
    probability: s.probability * (bases.has(languageBase(s.language)) ? weight : 1),
  }));
  const unnamed = Math.max(0, 1 - scores.reduce((sum, s) => sum + s.probability, 0));
  const total = weighted.reduce((sum, s) => sum + s.probability, 0) + unnamed;
  return sorted(total > 0 ? weighted.map((s) => ({ ...s, probability: s.probability / total })) : weighted);
}

const durationOf = (piece: IdentifiedPiece) => Math.max(0, piece.endMs - piece.startMs);

/**
 * The pieces as one answer: the duration-weighted mean of their log-probabilities (Anuvani's own aggregation),
 * each piece with the prior applied first. Not renormalised: on mixed speech it falls, by construction.
 */
export function aggregatePieces(
  pieces: readonly IdentifiedPiece[],
  spoken: readonly string[],
  weight: number,
): LanguageScore[] {
  const total = pieces.reduce((sum, piece) => sum + durationOf(piece), 0);
  if (pieces.length === 0 || total <= 0) return [];
  const logs = new Map<string, number>();
  for (const piece of pieces) {
    const share = durationOf(piece) / total;
    for (const score of withPrior(piece.scores, spoken, weight))
      logs.set(
        score.language,
        (logs.get(score.language) ?? 0) + share * Math.log(Math.max(score.probability, 1e-9)),
      );
  }
  return sorted([...logs].map(([language, log]) => ({ language, probability: Math.exp(log) })));
}

/** Two or three languages, each sure in its own pieces and a real share of the speech, most speech first. */
function mixOf(
  pieces: readonly IdentifiedPiece[],
  spoken: readonly string[],
  config: LanguageDecisionConfig,
): { languages: string[]; confidence: number } | null {
  const voting = pieces.filter((piece) => durationOf(piece) >= config.minPieceMs);
  const total = voting.reduce((sum, piece) => sum + durationOf(piece), 0);
  if (voting.length < 2 || total <= 0) return null;
  const share = new Map<string, number>();
  const sure = new Map<string, number>();
  for (const piece of voting) {
    const top = withPrior(piece.scores, spoken, config.priorWeight)[0];
    if (!top || top.probability < config.floor) continue;
    share.set(top.language, (share.get(top.language) ?? 0) + durationOf(piece) / total);
    sure.set(top.language, Math.min(sure.get(top.language) ?? 1, top.probability));
  }
  const mixed = [...share]
    .filter(([, part]) => part >= config.mixShare)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (mixed.length < 2) return null;
  return {
    languages: mixed.map(([language]) => language),
    confidence: Math.min(...mixed.map(([language]) => sure.get(language) ?? 0)),
  };
}

const UNCLEAR = (confidence: number | null, source: DecisionSource): LanguageDecision => ({
  state: 'unclear',
  languages: [],
  confidence: confidence === null ? null : round(confidence),
  source,
});

const detected = (language: string, confidence: number, source: DecisionSource): LanguageDecision => ({
  state: 'detected',
  languages: [language],
  confidence: round(confidence),
  source,
});

function round(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
}

function byWhisper(
  whisper: readonly LanguageScore[],
  evidence: LanguageEvidence,
  config: LanguageDecisionConfig,
) {
  const top = withPrior(whisper, evidence.spoken, config.priorWeight)[0];
  if (!top) return UNCLEAR(null, 'none');
  return top.probability >= config.whisperFloor
    ? detected(top.language, top.probability, 'whisper')
    : UNCLEAR(top.probability, 'whisper');
}

export function decideLanguage(
  evidence: LanguageEvidence,
  config: LanguageDecisionConfig = LANGUAGE_DECISION,
): LanguageDecision {
  if (evidence.chosen)
    return { state: 'chosen', languages: [evidence.chosen], confidence: null, source: 'chosen' };
  const whisper = sorted(evidence.whisper ?? []);
  const heard = whisper[0];
  const foreign = heard && !identifierNames(heard.language) && heard.probability >= config.foreignFloor;
  const pieces = evidence.pieces ?? [];
  if (foreign || pieces.length === 0) return byWhisper(whisper, evidence, config);

  const mix = mixOf([...pieces, ...(evidence.later ?? [])], evidence.spoken, config);
  if (mix)
    return {
      state: 'mixed',
      languages: mix.languages,
      confidence: round(mix.confidence),
      source: 'identifier',
    };
  const overall = aggregatePieces(pieces, evidence.spoken, config.priorWeight);
  const best = overall[0];
  const fromWhisper = withPrior(whisper, evidence.spoken, config.priorWeight)[0];
  // Whisper sure of English: it stands unless the identifier is surer of another language.
  const english =
    fromWhisper &&
    languageBase(fromWhisper.language) === 'en' &&
    fromWhisper.probability >= config.englishFloor;
  if (english && (!best || best.probability < fromWhisper.probability))
    return detected(fromWhisper.language, fromWhisper.probability, 'whisper');
  if (best && best.probability >= config.floor)
    return detected(best.language, best.probability, 'identifier');

  // The identifier is unsure: Whisper's answer stands if it is sure and the identifier ranks it near the top too.
  const rank = fromWhisper
    ? overall.findIndex((score) => languageBase(score.language) === languageBase(fromWhisper.language))
    : -1;
  if (fromWhisper && fromWhisper.probability >= config.whisperFloor && rank >= 0 && rank < config.agreeRank)
    return detected(fromWhisper.language, fromWhisper.probability, 'whisper');
  return UNCLEAR(best?.probability ?? null, 'identifier');
}
