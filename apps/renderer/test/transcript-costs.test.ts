// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-AGT: no cost line under each message. A step's cost that goes ahead by itself joins its run's block (shown in
// the run's details), wherever it arrives and without splitting the block; one that asks before spending stays a
// card in the transcript, where it can be answered.
import { newId, type CardOf, type CostEstimateCardV2, type RunId } from '@taalcut/core';
import { CARD_FIXTURES } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '../src/chat/transcript';
import { transcriptRows, type Row } from '../src/chat/transcript-rows';

const runId = newId<'AgentRun'>() as RunId;
const plan = { ...CARD_FIXTURES.plan.running!, runId, id: `plan:${runId}` } as CardOf<'plan'>;
const tool = { ...CARD_FIXTURES.toolRun.succeeded!, runId, id: 'tool:one' } as CardOf<'toolRun'>;
const cost = (id: string, status: CostEstimateCardV2['status']): CostEstimateCardV2 => ({
  ...(CARD_FIXTURES.costEstimate.goingAhead as CostEstimateCardV2),
  runId,
  id,
  status,
  ...(status === 'asking' ? { approvalId: `ap-${id}` } : {}),
});

const card = (c: CardOf<'plan'> | CardOf<'toolRun'> | CostEstimateCardV2): TranscriptItem => ({
  kind: 'card',
  key: c.id,
  card: c,
});
const words = (key: string): TranscriptItem => ({
  kind: 'agent',
  key,
  runId,
  text: 'Done.',
  streaming: false,
  at: 1,
});
const shape = (rows: readonly Row[]) =>
  rows.map((row) =>
    row.kind === 'run'
      ? { run: { plan: Boolean(row.plan), tools: row.tools.length, costs: row.costs.map((c) => c.id) } }
      : row.item.kind === 'card'
        ? row.item.card.type
        : row.item.kind,
  );

describe('a run’s costs in the transcript', () => {
  it('fold into the run’s block, and keep the block whole', () => {
    const rows = transcriptRows([card(plan), card(cost('cost:read', 'going-ahead')), card(tool)]);
    expect(shape(rows)).toEqual([{ run: { plan: true, tools: 1, costs: ['cost:read'] } }]);
  });

  it('settled after the agent spoke: still in that run’s block, never a line under the message', () => {
    const rows = transcriptRows([
      card(plan),
      card(tool),
      words('words:1'),
      card(cost('cost:read', 'settled')),
    ]);
    expect(shape(rows)).toEqual(['agent', { run: { plan: true, tools: 1, costs: ['cost:read'] } }]);
  });

  it('a cost before anything else of its run starts the run’s block', () => {
    const rows = transcriptRows([words('words:0'), card(cost('cost:first', 'going-ahead')), card(tool)]);
    expect(shape(rows)).toEqual(['agent', { run: { plan: false, tools: 1, costs: ['cost:first'] } }]);
  });

  it('a cost that asks before spending stays a card of its own', () => {
    const rows = transcriptRows([card(plan), card(cost('cost:ask', 'asking'))]);
    expect(shape(rows)).toEqual(['costEstimate', { run: { plan: true, tools: 0, costs: [] } }]);
  });
});
