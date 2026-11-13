// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type CardOf, type ChatHistoryEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { reducer } from '../src/chat/conversation-reducer';
import { mergeSavedCovers } from '../src/chat/saved-cover-history';
import type { Transcript } from '../src/chat/transcript';
import { transcriptRows } from '../src/chat/transcript-rows';

const oldRun = newId<'AgentRun'>();
const liveRun = newId<'AgentRun'>();
const toolRunId = newId<'ToolRun'>();
const liveMessage = newId<'Message'>();
const card: CardOf<'toolRun'> = {
  type: 'toolRun',
  version: 1,
  id: `cover:${toolRunId}`,
  runId: oldRun,
  toolRunId,
  tool: 'render.exportCover',
  status: 'succeeded',
  startedAt: 1,
  finishedAt: 3,
  savedCover: { fileName: 'Airport.jpg', width: 1080, height: 1920, revision: 41 },
};
const event: ChatHistoryEvent = { type: 'agent.card', payload: { runId: oldRun, card }, at: 3 };
const state = (): Transcript => ({
  activeRunId: liveRun,
  reasoning: 'high',
  runs: { [oldRun]: 'cancelled', [liveRun]: 'running' },
  items: [
    { kind: 'user', key: 'old-user', text: 'Save a cover', at: 0 },
    { kind: 'notice', key: 'old-stopped', runId: oldRun, notice: 'cancelled' },
    { kind: 'user', key: 'new-user', text: 'Check the colours', at: 4 },
    { kind: 'agent', key: 'live-text', runId: liveRun, text: 'Checking the', streaming: true, at: 5 },
    {
      kind: 'reasoning',
      key: 'live-thought',
      runId: liveRun,
      text: 'Compare the frames',
      working: true,
      startedAt: 5,
    },
  ],
});

describe('late saved cover history', () => {
  it('inserts the saved result beside its cancelled run without touching a newer stream', () => {
    const before = state();
    const after = reducer(before, { type: 'saved-covers', history: [event] });
    expect(after.items.map((item) => item.key)).toEqual([
      'old-user',
      'old-stopped',
      card.id,
      'new-user',
      'live-text',
      'live-thought',
    ]);
    expect(after.activeRunId).toBe(liveRun);
    expect(after.runs).toBe(before.runs);
    expect(after.reasoning).toBe('high');
    expect(after.items.at(-1)).toBe(before.items.at(-1));
    expect(after.items.at(-2)).toBe(before.items.at(-2));
    const rows = transcriptRows(after.items, after.runs);
    expect(rows.find((row) => row.key === card.id)).toMatchObject({ kind: 'item' });
    expect(rows.filter((row) => row.kind === 'run').flatMap((row) => row.tools)).toEqual([]);
  });

  it('deduplicates receipts from repeated invalidations and ignores ordinary streamed history', () => {
    const before = mergeSavedCovers(state(), [event]);
    const history: ChatHistoryEvent[] = [
      event,
      event,
      {
        type: 'agent.messageDelta',
        at: 5,
        payload: { runId: liveRun, messageId: liveMessage, delta: 'Checking the' },
      },
    ];
    expect(mergeSavedCovers(before, history)).toBe(before);
  });

  it('treats a saved cover as a result rather than a new tool phase after the final answer', () => {
    const rows = transcriptRows(
      [
        { kind: 'agent', key: 'intro', runId: oldRun, text: 'Saving the cover.', streaming: false, at: 1 },
        { kind: 'card', key: 'tool', card: { ...card, id: 'tool', savedCover: undefined } },
        {
          kind: 'agent',
          key: 'answer',
          runId: oldRun,
          text: 'Your cover is saved.',
          streaming: false,
          at: 3,
        },
        { kind: 'card', key: card.id, card },
      ],
      { [oldRun]: 'succeeded' },
    );
    expect(rows.map((row) => (row.kind === 'run' ? 'activity' : row.key))).toEqual([
      'answer',
      card.id,
      'activity',
    ]);
  });

  it('ignores malformed receipts and unknown runs instead of creating orphan results', () => {
    const before = state();
    const malformed = {
      ...event,
      payload: {
        ...event.payload,
        card: { ...card, savedCover: { ...card.savedCover!, fileName: '../secret.jpg' } },
      },
    };
    const unknown = {
      ...event,
      payload: { ...event.payload, card: { ...card, runId: newId<'AgentRun'>() } },
    };
    expect(mergeSavedCovers(before, [malformed, unknown])).toBe(before);
  });
});
