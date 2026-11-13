// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type Card, type RunId } from '@taalcut/core';
import { CARD_FIXTURES } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '../src/chat/transcript';
import { transcriptRows } from '../src/chat/transcript-rows';

const runId = newId<'AgentRun'>() as RunId;
const words = (key: string, text = key): TranscriptItem => ({
  kind: 'agent',
  key,
  runId,
  text,
  streaming: false,
  at: 1,
});
const card = (value: Card): TranscriptItem => ({ kind: 'card', key: value.id, card: value });
const tool = (id: string): TranscriptItem =>
  card({
    ...CARD_FIXTURES.toolRun.succeeded!,
    type: 'toolRun',
    version: 1,
    id,
    runId,
  } as Card);
const user = (key: string): TranscriptItem => ({ kind: 'user', key, text: key, at: 1 });
const reasoning: TranscriptItem = {
  kind: 'reasoning',
  key: 'reasoning',
  runId,
  text: 'Check the closing shot.',
  working: false,
  startedAt: 1,
  endedAt: 2,
};
const approval = card({ ...CARD_FIXTURES.approval.pending!, runId } as Card);
const keys = (rows: ReturnType<typeof transcriptRows>) =>
  rows.map((row) => (row.kind === 'run' ? 'activity' : row.key));

describe('result-first transcript activity', () => {
  it('keeps the final response and real result above one activity with earlier commentary and reasoning', () => {
    const result = card(CARD_FIXTURES.motionGraphic['shopping list']!);
    const items = [
      user('request'),
      words('intro'),
      reasoning,
      tool('first'),
      words('update'),
      tool('second'),
      words('result'),
      result,
    ];
    const before = structuredClone(items);
    const rows = transcriptRows(items, { [runId]: 'succeeded' });
    expect(keys(rows)).toEqual(['request', 'result', result.key, 'activity']);
    const work = rows.at(-1)!;
    expect(work.kind).toBe('run');
    if (work.kind !== 'run') return;
    expect(work.status).toBe('succeeded');
    expect(work.tools.map(({ card }) => card.id)).toEqual(['first', 'second']);
    expect(work.notes.map((note) => note.key)).toEqual(['intro', 'reasoning', 'update']);
    expect(items).toEqual(before);
  });

  it('keeps live commentary visible and uses run status after all calls have finished', () => {
    const rows = transcriptRows([words('intro'), tool('first'), words('update'), tool('second')], {
      [runId]: 'running',
    });
    expect(keys(rows)).toEqual(['intro', 'update', 'activity']);
    expect(rows.at(-1)).toMatchObject({
      status: 'running',
      notes: [],
      tools: [{ card: { id: 'first' } }, { card: { id: 'second' } }],
    });
  });

  it('never separates a decision from its explanation when a later response exists', () => {
    const rows = transcriptRows(
      [words('intro'), tool('first'), words('explanation'), approval, words('result')],
      { [runId]: 'succeeded' },
    );
    expect(keys(rows)).toEqual(['explanation', approval.key, 'result', 'activity']);
    expect(rows.at(-1)).toMatchObject({ notes: [{ key: 'intro' }] });
  });

  it('keeps the paused question and Stop notice outside activity', () => {
    const notice: TranscriptItem = { kind: 'notice', key: 'paused', runId, notice: 'paused' };
    const rows = transcriptRows([reasoning, tool('first'), words('explanation'), approval, notice], {
      [runId]: 'paused',
    });
    expect(keys(rows)).toEqual(['explanation', approval.key, 'paused', 'activity']);
    expect(rows.at(-1)).toMatchObject({ status: 'paused', notes: [{ key: 'reasoning' }] });
  });

  it('retains failures, unsupported results and cancellation notices outside activity', () => {
    const error = card(CARD_FIXTURES.error.withFix!);
    const unsupported: TranscriptItem = { kind: 'unsupported', key: 'unsupported' };
    const notice: TranscriptItem = { kind: 'notice', key: 'stopped', runId, notice: 'cancelled' };
    const rows = transcriptRows([tool('first'), words('failure'), error, unsupported, notice], {
      [runId]: 'cancelled',
    });
    expect(keys(rows)).toEqual(['failure', error.key, 'unsupported', 'stopped', 'activity']);
    expect(rows.at(-1)).toMatchObject({ status: 'cancelled' });
  });

  it.each(['failed', 'cancelled'] as const)(
    'keeps all progress context when the run %s without a final answer',
    (status) => {
      const rows = transcriptRows([words('intro'), tool('first'), words('still-checking'), tool('second')], {
        [runId]: status,
      });
      expect(keys(rows)).toEqual(['intro', 'still-checking', 'activity']);
      expect(rows.at(-1)).toMatchObject({ status, notes: [] });
    },
  );

  it('does not invent a result when a successful call is the last event', () => {
    const rows = transcriptRows([tool('first')], { [runId]: 'succeeded' });
    expect(keys(rows)).toEqual(['activity']);
    expect(rows[0]).toMatchObject({ status: 'succeeded', notes: [], tools: [{ card: { id: 'first' } }] });
  });

  it.each(['failed', 'cancelled'] as const)(
    'folds earlier commentary when a %s run actually concludes afterward',
    (status) => {
      const failed = card({ ...CARD_FIXTURES.toolRun.failed!, id: 'failed-call', runId });
      const rows = transcriptRows([words('intro'), failed, words('could-not-finish')], { [runId]: status });
      expect(keys(rows)).toEqual(['could-not-finish', 'activity']);
      expect(rows.at(-1)).toMatchObject({
        status,
        notes: [{ key: 'intro' }],
        tools: [{ card: { status: 'failed' } }],
      });
    },
  );

  it('shows the specific failed-call recovery once instead of the synthetic run fallback', () => {
    const failed = card({ ...CARD_FIXTURES.toolRun.failed!, id: 'failed-call', runId });
    const fallback = card({
      type: 'error',
      id: `run-error:${runId}`,
      version: 1,
      error: { code: 'agent.run_failed', messageKey: 'errors.agent.run_failed', retryable: false },
    });
    const rows = transcriptRows([words('intro'), failed, words('could-not-finish'), fallback], {
      [runId]: 'failed',
    });
    expect(keys(rows)).toEqual(['could-not-finish', 'activity']);
    expect(rows.at(-1)).toMatchObject({ tools: [{ card: { error: { code: 'core.timeout' } } }] });
    expect(keys(transcriptRows([words('could-not-finish'), fallback], { [runId]: 'failed' }))).toEqual([
      'could-not-finish',
      fallback.key,
    ]);
    expect(
      keys(
        transcriptRows([failed, user('next-request'), words('could-not-finish'), fallback], {
          [runId]: 'failed',
        }),
      ),
    ).toEqual(['activity', 'next-request', 'could-not-finish', fallback.key]);
  });

  it('keeps distinct run errors even when a failed tool already has a recovery', () => {
    const failed = card({ ...CARD_FIXTURES.toolRun.failed!, id: 'failed-call', runId });
    const distinct = card({ ...CARD_FIXTURES.error.withFix!, id: `run-error:${runId}` });
    const rows = transcriptRows([failed, words('failure-explanation'), distinct], { [runId]: 'failed' });
    expect(keys(rows)).toEqual(['failure-explanation', distinct.key, 'activity']);
  });

  it('keeps activity inside its user-message boundary and stable as calls arrive', () => {
    const first = transcriptRows([user('first-request'), tool('first')]);
    const rows = transcriptRows([
      user('first-request'),
      tool('first'),
      words('first-result'),
      user('next-request'),
      tool('next'),
      words('next-result'),
    ]);
    expect(keys(rows)).toEqual([
      'first-request',
      'first-result',
      'activity',
      'next-request',
      'next-result',
      'activity',
    ]);
    expect(rows[2]?.key).toBe(first[1]?.key);
    expect(rows[2]?.key).not.toBe(rows[5]?.key);
  });
});
