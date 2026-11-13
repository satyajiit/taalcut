// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B15 "passes the tone evals on all 3 providers": the report's pass rules (SPEC section 22) on synthetic
 * recordings made with the session runner and stand-in models. A clean recording passes; each rule failing
 * fails it; flipped pair verdicts are dropped and counted; a judge that wrote what it judges is refused; a
 * stand-in, stale or two-provider recording is "unmeasured", never "passed".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import {
  loadTonePromptSet,
  pairSummary,
  readSoul,
  runToneSession,
  toneReport,
  type ToneRecording,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { STAND_IN_AUTHORS, STAND_IN_JUDGE, standInToneModels } from './support/tone-stand-in';

const SOUL = unwrap(
  readSoul(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'SOUL.md'), 'utf8')),
);
const { set, sha256 } = unwrap(loadTonePromptSet());
const PROMPTS = set.prompts;
const current = { soulVersion: SOUL.version, promptSetSha256: sha256 };

async function session(options: { standIn?: boolean; fourthJudge?: boolean } = {}): Promise<ToneRecording> {
  return unwrap(
    await runToneSession({
      models: standInToneModels(PROMPTS),
      soul: SOUL,
      prompts: PROMPTS,
      promptSetSha256: sha256,
      authors: STAND_IN_AUTHORS,
      ...(options.fourthJudge === false ? {} : { judge: STAND_IN_JUDGE }),
      standIn: options.standIn ?? false,
      today: '2026-10-14',
    }),
  );
}

const report = (recording: ToneRecording) => unwrap(toneReport({ prompts: PROMPTS, recording, current }));

function rescore(recording: ToneRecording, promptId: string, author: string, scores: Record<string, number>) {
  return {
    ...recording,
    ratings: recording.ratings.map((r) =>
      r.promptId === promptId && r.author === author ? { ...r, scores: { ...r.scores, ...scores } } : r,
    ),
  };
}

function rewrite(recording: ToneRecording, promptId: string, author: string, text: string): ToneRecording {
  return {
    ...recording,
    replies: recording.replies.map((r) =>
      r.promptId === promptId && r.author === author ? { ...r, text } : r,
    ),
  };
}

describe('the tone session', () => {
  it('records every author on every prompt, a score per reply and each pair in both orders', async () => {
    const recording = await session();
    expect(recording.replies).toHaveLength(60);
    expect(recording.ratings).toHaveLength(60);
    expect(recording.pairs).toHaveLength(20 * 3 * 2);
    expect(recording.judgePromptVersion).toBe('1.0.0');
    expect(new Set(recording.ratings.map((r) => r.judge.provider))).toEqual(new Set(['stand-in-judge']));
  });

  it('without a fourth provider the judge rotates and never judges its own replies', async () => {
    const recording = await session({ fourthJudge: false });
    expect(recording.ratings.every((r) => r.judge.provider !== r.author)).toBe(true);
    expect(recording.pairs.every((p) => p.judge.provider !== p.first && p.judge.provider !== p.second)).toBe(
      true,
    );
    expect(new Set(recording.ratings.map((r) => r.judge.provider)).size).toBe(3);
    expect(report(recording).status).toBe('passed');
  });

  it('stops at the first failed call or unparsable verdict', async () => {
    const failing = standInToneModels(PROMPTS);
    const broken = {
      ...failing,
      complete: async () => ({
        ok: false as const,
        error: { code: 'models.rate_limited', messageKey: 'x', retryable: true },
      }),
    };
    const failed = await runToneSession({
      models: broken,
      soul: SOUL,
      prompts: PROMPTS,
      promptSetSha256: sha256,
      authors: STAND_IN_AUTHORS,
      standIn: true,
      today: '2026-10-14',
    });
    expect(!failed.ok && failed.error.code).toBe('models.rate_limited');
  });
});

describe('the pass rules', () => {
  it('a clean recording on three providers with a consistent judge passes', async () => {
    const result = report(await session());
    expect(result).toMatchObject({
      status: 'passed',
      judgeValid: true,
      inconsistencyRate: 0,
      n: 60,
      reasons: [],
    });
    expect(result.providers.map((p) => p.status)).toEqual(['passed', 'passed', 'passed']);
    expect(result.providers[0]?.means).toEqual({
      warmth: 5,
      brevity: 5,
      noSycophancy: 5,
      noSlop: 5,
      followsDials: 5,
    });
  });

  it('a mean under 4.0 on one axis fails that provider and names the axis', async () => {
    let recording = await session();
    for (const p of PROMPTS.slice(0, 12)) recording = rescore(recording, p.id, 'stand-in-b', { brevity: 2 });
    const result = report(recording);
    expect(result.status).toBe('failed');
    const b = result.providers.find((p) => p.provider === 'stand-in-b');
    expect(b?.failures).toContainEqual(expect.objectContaining({ check: 'brevity' }));
    expect(result.providers.find((p) => p.provider === 'stand-in-a')?.status).toBe('passed');
  });

  it('a trap reply under 4 on its axis fails, even when the means hold', async () => {
    const result = report(rescore(await session(), 't17', 'stand-in-c', { noSycophancy: 3 }));
    expect(result.status).toBe('failed');
    expect(result.providers.find((p) => p.provider === 'stand-in-c')?.failures).toEqual([
      expect.objectContaining({ promptId: 't17', check: 'noSycophancy' }),
    ]);
  });

  it('an emoji or an exclamation mark at professional fails, and so does a reply in the wrong language', async () => {
    let recording = rewrite(await session(), 't10', 'stand-in-a', 'Captions are off 🎬.');
    recording = rewrite(recording, 't12', 'stand-in-a', 'Yes, it is ready!');
    recording = rewrite(recording, 't03', 'stand-in-b', 'Done, the captions are bigger.');
    const result = report(recording);
    expect(result.status).toBe('failed');
    expect(result.providers.find((p) => p.provider === 'stand-in-a')?.failures.map((f) => f.check)).toEqual([
      'emoji',
      'exclamation',
    ]);
    expect(result.providers.find((p) => p.provider === 'stand-in-b')?.failures).toEqual([
      expect.objectContaining({ promptId: 't03', check: 'language' }),
    ]);
  });

  it('a missing reply or score fails the provider', async () => {
    const recording = await session();
    const result = report({
      ...recording,
      replies: recording.replies.filter((r) => !(r.promptId === 't01' && r.author === 'stand-in-a')),
      ratings: recording.ratings.filter((r) => !(r.promptId === 't02' && r.author === 'stand-in-a')),
    });
    expect(result.providers[0]?.failures.map((f) => f.check)).toEqual(['missingReply', 'missingScore']);
  });

  it('a judge that wrote a reply it judges is refused', async () => {
    const recording = await session();
    const own = {
      ...recording,
      ratings: recording.ratings.map((r, i) =>
        i === 0 ? { ...r, judge: { provider: r.author, model: 'x' } } : r,
      ),
    };
    const refused = toneReport({ prompts: PROMPTS, recording: own, current });
    expect(!refused.ok && refused.error).toMatchObject({
      code: 'agent.tone_recording_invalid',
      params: { rule: 'judgeIsAuthor' },
    });
    const pair = {
      ...recording,
      pairs: recording.pairs.map((p, i) =>
        i === 0 ? { ...p, judge: { provider: p.second, model: 'x' } } : p,
      ),
    };
    expect(toneReport({ prompts: PROMPTS, recording: pair, current }).ok).toBe(false);
  });
});

describe('swapped-order pairs', () => {
  const both = (promptId: string, ab: 'first' | 'second' | 'tie', ba: 'first' | 'second' | 'tie') => [
    { promptId, first: 'a', second: 'b', judge: STAND_IN_JUDGE, winner: ab },
    { promptId, first: 'b', second: 'a', judge: STAND_IN_JUDGE, winner: ba },
  ];

  it('drops a flipped verdict from the win rate and counts it as inconsistent', () => {
    const summary = pairSummary({
      pairs: [
        ...both('t01', 'first', 'second'), // a both times
        ...both('t02', 'first', 'second'), // a
        ...both('t03', 'second', 'first'), // b
        ...both('t04', 'first', 'first'), // flipped: whoever is first wins
        ...both('t05', 'tie', 'tie'),
        ...both('t06', 'first', 'first').slice(0, 1), // one order only
      ],
    });
    expect(summary.pairs).toEqual([
      { a: 'a', b: 'b', aWins: 2, bWins: 1, ties: 1, inconsistent: 1, oneOrder: 1, winRateA: 2 / 3 },
    ]);
    expect(summary.judged).toBe(5);
    expect(summary.inconsistencyRate).toBeCloseTo(0.2);
  });

  it('a judge flipping more than 20 % of pairs makes the run invalid, and so fails it', async () => {
    const recording = await session();
    // Make the judge always prefer whichever reply it reads first: every pair flips.
    const flipped = { ...recording, pairs: recording.pairs.map((p) => ({ ...p, winner: 'first' as const })) };
    const result = report(flipped);
    expect(result).toMatchObject({ status: 'failed', judgeValid: false, inconsistencyRate: 1 });
    expect(result.reasons.join(' ')).toMatch(/over 20 %/);
    expect(result.pairs.every((p) => p.winRateA === null)).toBe(true);
  });

  it('no pair judged in both orders is not a valid judge run', async () => {
    const recording = await session();
    const result = report({ ...recording, pairs: recording.pairs.filter((p) => p.first < p.second) });
    expect(result).toMatchObject({ judgeValid: false, status: 'failed' });
  });
});

describe('unmeasured, never passed', () => {
  it('a stand-in recording reports unmeasured with every number still computed', async () => {
    const result = report(await session({ standIn: true }));
    expect(result.status).toBe('unmeasured');
    expect(result.standIn).toBe(true);
    expect(result.reasons[0]).toMatch(/stand-in/);
    expect(result.providers.every((p) => p.status === 'passed')).toBe(true);
  });

  it('a recording for another SOUL.md version or prompt set is stale', async () => {
    const recording = await session();
    expect(report({ ...recording, soulVersion: '0.1.0' }).status).toBe('unmeasured');
    expect(report({ ...recording, promptSetSha256: '0'.repeat(64) }).status).toBe('unmeasured');
  });

  it('fewer than three providers is unmeasured', async () => {
    const recording = await session();
    const two = {
      ...recording,
      authors: recording.authors.slice(0, 2),
    };
    expect(report(two)).toMatchObject({ status: 'unmeasured' });
    expect(report(two).reasons.join(' ')).toMatch(/Only 2 providers/);
  });
});
