// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Records a tone session (SPEC section 22): every author answers every frozen prompt with the run's prompt
 * (SOUL.md, the prompt's dials, the rules) and the turn's tool results; then the judge scores each reply on
 * the rubric and judges every pair of authors in both orders. Everything goes through a ModelClient, so the
 * same code records against real providers (TAALCUT_RECORD=1, real keys, about US$5: 60 replies, 60 scores,
 * 120 pair verdicts) and against stand-ins in tests. Calls run one at a time; the first failure stops it.
 */
import { ok, wrapUntrusted, type AsyncResult } from '@taalcut/core';
import type { ModelClient } from '@taalcut/models';
import { CONTROL_PREFIX, systemPrompt } from '../prompt';
import { runSoul } from '../soul/dials';
import type { Soul } from '../soul/soul-file';
import {
  JUDGE_PROMPT_VERSION,
  judgeSystemPrompt,
  pairRequest,
  parsePairAnswer,
  parseRubricAnswer,
  pickJudge,
  rubricRequest,
} from './tone-judge';
import type { ModelRef, TonePrompt, ToneRecording } from './tone-types';

/** Balanced's three cloud chat models (SPEC section 22): the authors of a real recording. */
export const TONE_AUTHORS: readonly ModelRef[] = [
  { provider: 'openai', model: 'gpt-5.4' },
  { provider: 'anthropic', model: 'claude-sonnet-5' },
  { provider: 'google', model: 'gemini-3.6-flash' },
];
/**
 * The fourth provider that judges a real recording. xAI's chat flagship in the model catalogue on
 * 2026-10-14; the PO confirms the id when recording (it is written into the recording with each verdict).
 */
export const TONE_JUDGE: ModelRef = { provider: 'xai', model: 'grok-4.5' };

export interface ToneSessionInput {
  readonly models: ModelClient;
  readonly soul: Soul;
  readonly prompts: readonly TonePrompt[];
  readonly promptSetSha256: string;
  readonly authors: readonly ModelRef[];
  /** A fourth provider; without one the judge rotates among the authors, never judging its own replies. */
  readonly judge?: ModelRef;
  /** Stand-in models: the recording is marked so its report is "unmeasured". */
  readonly standIn: boolean;
  readonly today: string;
  readonly signal?: AbortSignal;
}

/** What the author sees: the user's message, then the turn's tool results, fenced like any tool output. */
function authorMessage(prompt: TonePrompt): string {
  return [
    prompt.message,
    `${CONTROL_PREFIX} The tools you called this turn returned:\n${wrapUntrusted(JSON.stringify(prompt.toolResults), 'tool-results')}`,
    `${CONTROL_PREFIX} Reply to the user now, in one message.`,
  ].join('\n\n');
}

type Ask = (target: ModelRef, system: string, text: string, temperature?: number) => AsyncResult<string>;
type Rating = ToneRecording['ratings'][number];
type PairVerdict = ToneRecording['pairs'][number];

/** One text-only completion, trimmed. */
function asker(input: ToneSessionInput): Ask {
  return async (target, system, text, temperature) => {
    const done = await input.models.complete({
      module: 'agent',
      target,
      system,
      messages: [{ role: 'user', content: text }],
      toolChoice: 'none',
      ...(temperature !== undefined ? { temperature } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return done.ok ? ok(done.value.text.trim()) : done;
  };
}

/** Every author answers every prompt with the run's system prompt at the prompt's dials. */
async function collectReplies(input: ToneSessionInput, ask: Ask): AsyncResult<ToneRecording['replies']> {
  const replies: ToneRecording['replies'] = [];
  for (const prompt of input.prompts) {
    const system = systemPrompt(runSoul(input.soul, prompt.dials), []);
    for (const author of input.authors) {
      const text = await ask(author, system, authorMessage(prompt));
      if (!text.ok) return text;
      replies.push({ promptId: prompt.id, author: author.provider, model: author.model, text: text.value });
    }
  }
  return ok(replies);
}

/** What judging needs: the judge's prompt, the replies, and the judge for the next rating or pair. */
interface JudgeRound {
  readonly ask: Ask;
  readonly soul: Soul;
  readonly authors: readonly ModelRef[];
  readonly system: string;
  readonly replyOf: (promptId: string, author: string) => string;
  /** The judge for replies by these providers; every call takes the next turn, judged or not. */
  readonly pick: (authors: readonly string[]) => ModelRef | undefined;
}

function judgeRotation(input: ToneSessionInput): JudgeRound['pick'] {
  const fourth = input.judge ? { judge: input.judge } : {};
  let turn = 0;
  return (authors) => pickJudge({ authors, ...fourth, candidates: input.authors, index: turn++ });
}

/** The rubric scores of one author's reply; undefined when nobody may judge it. */
async function rating(
  round: JudgeRound,
  prompt: TonePrompt,
  author: ModelRef,
): AsyncResult<Rating | undefined> {
  const judge = round.pick([author.provider]);
  if (!judge) return ok(undefined);
  const request = rubricRequest(round.soul, prompt, round.replyOf(prompt.id, author.provider));
  const answer = await round.ask(judge, round.system, request, 0);
  if (!answer.ok) return answer;
  const scores = parseRubricAnswer(answer.value);
  return scores.ok
    ? ok({ promptId: prompt.id, author: author.provider, judge, scores: scores.value })
    : scores;
}

/** Two authors' replies judged in both orders by one judge; none when nobody may judge them. */
async function pairVerdicts(
  round: JudgeRound,
  prompt: TonePrompt,
  a: ModelRef,
  b: ModelRef,
): AsyncResult<PairVerdict[]> {
  const judge = round.pick([a.provider, b.provider]);
  if (!judge) return ok([]);
  const verdicts: PairVerdict[] = [];
  for (const [first, second] of [
    [a, b],
    [b, a],
  ] as const) {
    const request = pairRequest(
      round.soul,
      prompt,
      round.replyOf(prompt.id, first.provider),
      round.replyOf(prompt.id, second.provider),
    );
    const answer = await round.ask(judge, round.system, request, 0);
    if (!answer.ok) return answer;
    const winner = parsePairAnswer(answer.value);
    if (!winner.ok) return winner;
    verdicts.push({
      promptId: prompt.id,
      first: first.provider,
      second: second.provider,
      judge,
      winner: winner.value,
    });
  }
  return ok(verdicts);
}

/** One prompt: every author's reply on the rubric, then every pair of authors. */
async function judgePrompt(
  round: JudgeRound,
  prompt: TonePrompt,
  into: { ratings: Rating[]; pairs: PairVerdict[] },
): AsyncResult<void> {
  for (const author of round.authors) {
    const rated = await rating(round, prompt, author);
    if (!rated.ok) return rated;
    if (rated.value) into.ratings.push(rated.value);
  }
  for (const [i, a] of round.authors.entries())
    for (const b of round.authors.slice(i + 1)) {
      const verdicts = await pairVerdicts(round, prompt, a, b);
      if (!verdicts.ok) return verdicts;
      into.pairs.push(...verdicts.value);
    }
  return ok(undefined);
}

export async function runToneSession(input: ToneSessionInput): AsyncResult<ToneRecording> {
  const { soul, authors } = input;
  const ask = asker(input);
  const replies = await collectReplies(input, ask);
  if (!replies.ok) return replies;
  const round: JudgeRound = {
    ask,
    soul,
    authors,
    system: judgeSystemPrompt(soul),
    replyOf: (promptId, author) =>
      replies.value.find((r) => r.promptId === promptId && r.author === author)?.text ?? '',
    pick: judgeRotation(input),
  };
  const judged: { ratings: Rating[]; pairs: PairVerdict[] } = { ratings: [], pairs: [] };
  for (const prompt of input.prompts) {
    const done = await judgePrompt(round, prompt, judged);
    if (!done.ok) return done;
  }
  return ok({
    standIn: input.standIn,
    recordedAt: input.today,
    soulVersion: soul.version,
    promptSetSha256: input.promptSetSha256,
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    authors: [...authors],
    replies: replies.value,
    ratings: judged.ratings,
    pairs: judged.pairs,
  });
}
