// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type CardOf } from '@taalcut/core';
import { MAKE_FIXTURES } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import { finishRun, replay, runEnded, type Transcript } from '../src/chat/transcript';

const runId = newId<'AgentRun'>();
const conversationId = newId<'Conversation'>();
const approval = (status: CardOf<'exportApproval'>['status']): CardOf<'exportApproval'> => ({
  ...MAKE_FIXTURES.exportApproval.pending,
  runId,
  status,
});
const initial = (status: CardOf<'exportApproval'>['status']): Transcript =>
  replay([
    { type: 'agent.runStarted', at: 1, payload: { runId, conversationId } },
    { type: 'agent.card', at: 2, payload: { runId, card: approval(status) } },
    { type: 'agent.runFinished', at: 3, payload: { runId, status: 'paused' } },
  ]);
const shown = (state: Transcript) => state.items.find((item) => item.kind === 'card');

describe('export approvals after a run ends', () => {
  it.each(['pending', 'updating', 'exporting'] as const)(
    'expires %s on cancellation in live and replayed history',
    (status) => {
      const paused = initial(status);
      expect(shown(paused)).toMatchObject({ card: { status } });
      const cancelled = finishRun(paused, runId, 'cancelled', 4);
      expect(shown(cancelled)).toMatchObject({ card: { status: 'expired' } });
      expect(
        replay([{ type: 'agent.runFinished', at: 4, payload: { runId, status: 'cancelled' } }], paused),
      ).toEqual(cancelled);
    },
  );

  it.each(['exported', 'declined', 'expired'] as const)('preserves a settled %s outcome', (status) => {
    expect(shown(finishRun(initial(status), runId, 'cancelled', 4))).toMatchObject({ card: { status } });
  });

  it('also closes stale questions when answering reveals the run already ended', () => {
    expect(shown(runEnded(initial('pending'), runId, null, 4))).toMatchObject({
      card: { status: 'expired' },
    });
  });
});
