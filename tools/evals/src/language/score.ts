// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Scores the evidence, pure. Each run is judged right, unclear or wrong under four ways of deciding:
 * - `before`: LIB0, Whisper tiny's first language with no floor (what the language stage stored; the transcript's
 *   own guess then overwrote it, so a clip could be filed under a language nobody in it spoke);
 * - `english`: a person whose languages are English only: the identifier isn't downloaded, Whisper decides with its
 *   floor;
 * - `own`: the person speaks the clip's language (and English): the identifier is there when that language is
 *   Indian;
 * - `indian`: a person who speaks Hindi and English, so the identifier is there for every clip.
 */
import {
  decideLanguage,
  LANGUAGE_DECISION,
  type LanguageDecisionConfig,
  type LanguageEvidence,
} from '@taalcut/audio';
import { isIndianLanguage, languageBase } from '@taalcut/core';
import type { EvidenceRow } from './evidence';
import type { LanguageClip, Truth } from './sets';

export const SCENARIOS = ['before', 'english', 'own', 'indian'] as const;
export type Scenario = (typeof SCENARIOS)[number];
export type Verdict = 'right' | 'unclear' | 'wrong';

export interface Outcome {
  readonly state: 'detected' | 'mixed' | 'unclear' | 'chosen';
  readonly languages: readonly string[];
}

const same = (a: string, b: string) => languageBase(a) === languageBase(b);

export function judge(truth: Truth, outcome: Outcome): Verdict {
  const named = outcome.state === 'unclear' ? [] : outcome.languages;
  if (named.length === 0) return truth.language === null && !truth.mix ? 'right' : 'unclear';
  if (named.length === 1) return truth.language && same(named[0] ?? '', truth.language) ? 'right' : 'wrong';
  const mix = truth.mix ?? [];
  const matches =
    named.length === mix.length && mix.every((language) => named.some((n) => same(n, language)));
  return matches ? 'right' : 'wrong';
}

function spokenFor(scenario: Scenario, truth: Truth): { spoken: string[]; identifier: boolean } {
  if (scenario === 'english') return { spoken: ['en'], identifier: false };
  if (scenario === 'indian') return { spoken: ['hi', 'en'], identifier: true };
  const own = truth.language ?? truth.mix?.[0];
  const spoken = own ? [...new Set([languageBase(own), 'en'])] : ['en'];
  return { spoken, identifier: spoken.some(isIndianLanguage) };
}

export function decide(
  row: EvidenceRow,
  truth: Truth,
  scenario: Scenario,
  config: LanguageDecisionConfig = LANGUAGE_DECISION,
): Outcome {
  if (row.failed || row.silent) return { state: 'unclear', languages: [] };
  if (scenario === 'before') {
    const top = row.whisper[0];
    return top ? { state: 'detected', languages: [top.language] } : { state: 'unclear', languages: [] };
  }
  const { spoken, identifier } = spokenFor(scenario, truth);
  const evidence: LanguageEvidence = {
    whisper: row.whisper,
    spoken,
    ...(identifier && row.pieces
      ? {
          pieces: row.pieces.filter((piece) => !piece.later),
          later: row.pieces.filter((piece) => piece.later),
        }
      : {}),
  };
  return decideLanguage(evidence, config);
}

export interface Tally {
  n: number;
  right: number;
  unclear: number;
  wrong: number;
}

export const emptyTally = (): Tally => ({ n: 0, right: 0, unclear: 0, wrong: 0 });

export function add(tally: Tally, verdict: Verdict): void {
  tally.n += 1;
  tally[verdict] += 1;
}

export interface Judged {
  readonly row: EvidenceRow;
  readonly clip: LanguageClip;
  readonly verdicts: Readonly<Record<Scenario, Verdict>>;
  readonly outcomes: Readonly<Record<Scenario, Outcome>>;
}

export function judgeAll(
  rows: readonly EvidenceRow[],
  clips: readonly LanguageClip[],
  config: LanguageDecisionConfig = LANGUAGE_DECISION,
): Judged[] {
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const judged: Judged[] = [];
  for (const row of rows) {
    const clip = byId.get(row.id);
    if (!clip) continue;
    const outcomes = Object.fromEntries(
      SCENARIOS.map((scenario) => [scenario, decide(row, clip.truth, scenario, config)]),
    ) as Record<Scenario, Outcome>;
    const verdicts = Object.fromEntries(
      SCENARIOS.map((scenario) => [scenario, judge(clip.truth, outcomes[scenario])]),
    ) as Record<Scenario, Verdict>;
    judged.push({ row, clip, verdicts, outcomes });
  }
  return judged;
}

/** Tallies per scenario over the judged runs `keep` picks. */
export function tallies(judged: readonly Judged[], keep: (j: Judged) => boolean = () => true) {
  const out = Object.fromEntries(SCENARIOS.map((scenario) => [scenario, emptyTally()])) as Record<
    Scenario,
    Tally
  >;
  for (const j of judged)
    if (keep(j)) for (const scenario of SCENARIOS) add(out[scenario], j.verdicts[scenario]);
  return out;
}

/** A wrong language costs three times an unclear one: "language unclear" is honest, a wrong name isn't. */
export const WRONG_COST = 3;

export function utility(tally: Tally): number {
  return tally.right - WRONG_COST * tally.wrong;
}
