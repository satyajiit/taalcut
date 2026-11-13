// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The on-device rules router (`taalcut/rules-router`, models SPEC P3.5): no model, no network, no cost. It
 * answers a `choice` question over tool families from the message: word lists per family in the four v1
 * languages (rules-keywords.ts) plus BM25 over each option's description and the tool one-liners the caller
 * passes as `localHints`. `none` wins when what the message says reads as chat, or no family scores above
 * RULES_ROUTER_CONFIG.minScore. It is the last entry of every router chain, so Local only and a missing key
 * still route.
 */
import { err, ok, type Result } from '@taalcut/core';
import { ModelUnsuitable } from '../errors';
import type { ClassifierAnswer, ClassifierQuestion, ClassifyRequest } from './classifier-types';
import { FAMILY_WORDS, NONE_WORDS, type FamilyWords } from './rules-keywords';
import { bm25, hasPhrase, phraseText, words } from './rules-text';

export const RULES_ROUTER = { provider: 'taalcut', model: 'rules-router' } as const;

export const RULES_ROUTER_CONFIG = {
  /** A family below this score loses to `none`. */
  minScore: 1,
  /** Weight of a strong word; a weak word counts 1. */
  strongWeight: 2,
  /** BM25 over the option's description and tools, added to the word score. */
  bm25Weight: 0.5,
  /** Words found in the state's other text (the step, earlier messages) count this much. */
  secondaryWeight: 0.4,
  /** The option that means "no tool". */
  noneOption: 'none',
} as const;

type ChoiceQuestion = Extract<ClassifierQuestion, { type: 'choice' }>;

/** Answers every question of the request, or refuses a question that isn't a choice. */
export function rulesClassify(request: ClassifyRequest): Result<Record<string, ClassifierAnswer>> {
  const answers: Record<string, ClassifierAnswer> = {};
  const { primary, secondary } = texts(request.state);
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type !== 'choice') {
      return err(
        ModelUnsuitable(
          { ...RULES_ROUTER, module: 'router', need: 'choice' },
          { detail: `The rules router answers choice questions only; ${id} is a ${question.type}.` },
        ),
      );
    }
    answers[id] = choose(question, primary, secondary, request.localHints?.[id]);
  }
  return ok(answers);
}

function choose(
  question: ChoiceQuestion,
  primary: string,
  secondary: string,
  hints: Readonly<Record<string, string>> | undefined,
): ClassifierAnswer {
  const config = RULES_ROUTER_CONFIG;
  const options = Object.keys(question.options);
  const families = options.filter((option) => option !== config.noneOption);
  const documents = new Map(
    families.map((family) => [
      family,
      `${family} ${question.options[family] ?? ''} ${hints?.[family] ?? ''}`,
    ]),
  );
  const relevance = bm25(documents).score(words(primary));
  const primaryText = phraseText(primary);
  const secondaryText = phraseText(secondary);
  const scores = new Map<string, number>();
  for (const family of families) {
    const list = FAMILY_WORDS[family];
    const score =
      (list ? hits(primaryText, list) + config.secondaryWeight * hits(secondaryText, list) : 0) +
      config.bm25Weight * (relevance.get(family) ?? 0);
    scores.set(family, score);
  }
  const best = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const noneScore = hits(primaryText, NONE_WORDS);
  const hasNone = options.includes(config.noneOption);
  const noneWins = hasNone && (!best || best[1] < config.minScore || (noneScore > 0 && noneScore >= best[1]));
  const choice = noneWins || !best ? config.noneOption : best[0];
  // Probabilities follow the scores, with the winner at least level with the best family.
  const raw = new Map<string, number>(families.map((family) => [family, (scores.get(family) ?? 0) + 0.05]));
  if (hasNone) raw.set(config.noneOption, Math.max(noneScore, noneWins ? (best?.[1] ?? 0) + 0.5 : 0) + 0.05);
  const total = [...raw.values()].reduce((sum, value) => sum + value, 0);
  const probabilities = Object.fromEntries(
    options.map((option) => [option, round((raw.get(option) ?? 0) / total)]),
  );
  return { type: 'choice', choice, probabilities, confidence: probabilities[choice] ?? 0 };
}

/** Weighted count of a word list's phrases in a padded phrase text. */
function hits(text: string, list: FamilyWords): number {
  let score = 0;
  for (const phrase of list.strong) if (hasPhrase(text, phrase)) score += RULES_ROUTER_CONFIG.strongWeight;
  for (const phrase of list.weak) if (hasPhrase(text, phrase)) score += 1;
  return score;
}

/** The message (state.message) and every other string in the state. */
function texts(state: Readonly<Record<string, unknown>>): { primary: string; secondary: string } {
  const strings = Object.entries(state).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  const message = strings.find(([key]) => key === 'message');
  if (!message) return { primary: strings.map(([, text]) => text).join('\n'), secondary: '' };
  return {
    primary: message[1],
    secondary: strings
      .filter(([key]) => key !== 'message')
      .map(([, text]) => text)
      .join('\n'),
  };
}

const round = (value: number) => Math.round(value * 1000) / 1000;
