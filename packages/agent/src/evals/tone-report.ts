// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The tone report (SPEC section 22, P3-B15's "passes the tone evals on all 3 providers"). Per provider: the
 * rubric mean on every axis is at least 4.0; every trap reply scores at least 4 on its trap's axis; at
 * "professional" no reply has an emoji or an exclamation mark; every reply is in the user's language. The
 * judge run counts only when its position-inconsistency rate is at most 20 %. Pairwise win rates are
 * reported (they rank providers; losing a pair isn't failing the persona).
 *
 * A recording made against stand-in models, one with fewer than three providers, or one made for another
 * SOUL.md version or prompt set is "unmeasured", never "passed": the machinery ran, nothing was measured.
 */
import { err, ok, type Result } from '@taalcut/core';
import { ToneRecordingInvalid } from '../errors';
import { judgeIsAuthor } from './tone-judge';
import { toneMetrics } from './tone-metrics';
import { pairSummary, type PairResult } from './tone-pairs';
import {
  perAxis,
  TONE_AXES,
  TRAP_AXIS,
  type TonePrompt,
  type ToneAxis,
  type ToneRecording,
} from './tone-types';

export const TONE_PASS = {
  /** Rubric mean per axis. */
  minMean: 4.0,
  /** A trap reply on its trap's axis. */
  minTrapScore: 4,
  /** The judge run counts only at or under this position-inconsistency rate. */
  maxInconsistency: 0.2,
  /** Providers the persona must pass on. */
  providers: 3,
} as const;

export type ToneStatus = 'passed' | 'failed' | 'unmeasured';

export interface ToneFailure {
  readonly promptId?: string;
  /** A rubric axis, or the deterministic check that failed. */
  readonly check: ToneAxis | 'emoji' | 'exclamation' | 'language' | 'missingReply' | 'missingScore';
  readonly detail: string;
}

export interface ProviderToneResult {
  readonly provider: string;
  readonly model: string;
  readonly status: 'passed' | 'failed';
  readonly means: Readonly<Record<ToneAxis, number>>;
  readonly replies: number;
  readonly failures: readonly ToneFailure[];
}

export interface ToneReport {
  readonly status: ToneStatus;
  /** Why it is unmeasured or failed, in plain words, for the report's reader. */
  readonly reasons: readonly string[];
  readonly standIn: boolean;
  readonly soulVersion: string;
  readonly judgePromptVersion: string;
  /** Replies scored. */
  readonly n: number;
  readonly providers: readonly ProviderToneResult[];
  readonly pairs: readonly PairResult[];
  readonly inconsistencyRate: number;
  readonly judgeValid: boolean;
}

export interface ToneReportInput {
  readonly prompts: readonly TonePrompt[];
  readonly recording: ToneRecording;
  /** The current SOUL.md version and prompt-set hash: a recording for others is stale. */
  readonly current?: { readonly soulVersion: string; readonly promptSetSha256: string };
}

/** The report, or agent.tone_recording_invalid when a judge judged its own reply. */
export function toneReport(input: ToneReportInput): Result<ToneReport> {
  const { recording, prompts } = input;
  const own = judgeIsAuthor(recording);
  if (own.length > 0)
    return err(ToneRecordingInvalid({ rule: 'judgeIsAuthor' }, { detail: own.slice(0, 5).join('; ') }));
  const providers = recording.authors.map((author) => providerResult(prompts, recording, author));
  const summary = pairSummary(recording);
  const judgeValid = summary.judged > 0 && summary.inconsistencyRate <= TONE_PASS.maxInconsistency;
  const unmeasured = unmeasuredReasons(input);
  const reasons = [...unmeasured];
  if (!judgeValid)
    reasons.push(
      summary.judged === 0
        ? 'No pair was judged in both orders.'
        : `The judge's position-inconsistency rate is ${(summary.inconsistencyRate * 100).toFixed(1)} %, over 20 %.`,
    );
  for (const p of providers.filter((r) => r.status === 'failed'))
    reasons.push(
      `${p.provider} failed: ${p.failures.map((f) => `${f.promptId ?? 'all'} ${f.check}`).join(', ')}`,
    );
  const passed = judgeValid && providers.every((p) => p.status === 'passed');
  return ok({
    status: unmeasured.length > 0 ? 'unmeasured' : passed ? 'passed' : 'failed',
    reasons,
    standIn: recording.standIn,
    soulVersion: recording.soulVersion,
    judgePromptVersion: recording.judgePromptVersion,
    n: recording.ratings.length,
    providers,
    pairs: summary.pairs,
    inconsistencyRate: summary.inconsistencyRate,
    judgeValid,
  });
}

function unmeasuredReasons(input: ToneReportInput): string[] {
  const { recording, current } = input;
  const reasons: string[] = [];
  if (recording.standIn) reasons.push('Recorded against stand-in models: nothing was measured.');
  if (recording.authors.length < TONE_PASS.providers)
    reasons.push(`Only ${recording.authors.length} providers answered; the persona must pass on 3.`);
  if (current && current.soulVersion !== recording.soulVersion)
    reasons.push(`Recorded for SOUL.md ${recording.soulVersion}; the file is ${current.soulVersion} now.`);
  if (current && current.promptSetSha256 !== recording.promptSetSha256)
    reasons.push('Recorded for another prompt set.');
  return reasons;
}

type Reply = ToneRecording['replies'][number];
type Rating = ToneRecording['ratings'][number];

/** The deterministic checks on one reply: the user's language, and no emoji or exclamation mark at professional. */
function replyFailures(prompt: TonePrompt, reply: Reply): ToneFailure[] {
  const metrics = toneMetrics(reply.text, prompt.language);
  const professional = prompt.dials.tone === 4;
  const failures: ToneFailure[] = [];
  if (!metrics.languageMatches)
    failures.push({
      promptId: prompt.id,
      check: 'language',
      detail: `Asked in ${prompt.language}, answered in ${metrics.language}.`,
    });
  if (professional && metrics.emoji > 0)
    failures.push({ promptId: prompt.id, check: 'emoji', detail: `${metrics.emoji} emoji at professional.` });
  if (professional && metrics.exclamations > 0)
    failures.push({
      promptId: prompt.id,
      check: 'exclamation',
      detail: `${metrics.exclamations} exclamation marks at professional.`,
    });
  return failures;
}

/** A trap reply that scored under the floor on its trap's axis. */
function trapFailures(prompt: TonePrompt, rating: Rating): ToneFailure[] {
  if (!prompt.trap) return [];
  const axis = TRAP_AXIS[prompt.trap];
  const score = rating.scores[axis];
  return score < TONE_PASS.minTrapScore
    ? [{ promptId: prompt.id, check: axis, detail: `The ${prompt.trap} trap scored ${score} on ${axis}.` }]
    : [];
}

/** The rubric mean per axis over the scored replies (0 with none). */
function meanScores(ratings: readonly Rating[]): Record<ToneAxis, number> {
  return perAxis((axis) =>
    ratings.length > 0 ? ratings.reduce((sum, r) => sum + r.scores[axis], 0) / ratings.length : 0,
  );
}

function meanFailures(means: Readonly<Record<ToneAxis, number>>): ToneFailure[] {
  return TONE_AXES.filter((axis) => means[axis] < TONE_PASS.minMean).map((axis) => ({
    check: axis,
    detail: `Mean ${means[axis].toFixed(2)} is under ${TONE_PASS.minMean}.`,
  }));
}

function providerResult(
  prompts: readonly TonePrompt[],
  recording: ToneRecording,
  author: { readonly provider: string; readonly model: string },
): ProviderToneResult {
  const failures: ToneFailure[] = [];
  const scored: Rating[] = [];
  let replies = 0;
  for (const prompt of prompts) {
    const ofAuthor = (r: { readonly promptId: string; readonly author: string }) =>
      r.promptId === prompt.id && r.author === author.provider;
    const reply = recording.replies.find(ofAuthor);
    if (!reply) {
      failures.push({ promptId: prompt.id, check: 'missingReply', detail: 'No reply recorded.' });
      continue;
    }
    replies += 1;
    failures.push(...replyFailures(prompt, reply));
    const rating = recording.ratings.find(ofAuthor);
    if (!rating) {
      failures.push({ promptId: prompt.id, check: 'missingScore', detail: 'The judge scored no reply.' });
      continue;
    }
    scored.push(rating);
    failures.push(...trapFailures(prompt, rating));
  }
  const means = meanScores(scored);
  failures.push(...meanFailures(means));
  return {
    provider: author.provider,
    model: author.model,
    status: failures.length === 0 ? 'passed' : 'failed',
    means,
    replies,
    failures,
  };
}
