// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Round P3-3 (P3-V4): an external agent's run asks with the same consent and project-cap cards as the agent's
 * own, and each says which external agent asked (`requester`), from the run's logged run.started. The built-in
 * agent's cards carry none.
 */
import { newId, type ChatEvent, type RunId, type ToolRunId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { RunTranslator } from '../../src/chat-translate';
import type { AgentEvent, EventPayloads } from '../../src/events';

const runId: RunId = newId<'AgentRun'>();
const sessionId = newId<'McpSession'>();
const toolCallId = 'call-1' as ToolRunId;

function log(external: EventPayloads['run.started']['external']): AgentEvent[] {
  const events: Omit<AgentEvent, 'runId' | 'seq' | 'v' | 'at'>[] = [
    {
      type: 'run.started',
      payload: {
        conversationId: newId<'Conversation'>(),
        message: '',
        autonomy: 'every-step',
        budget: {},
        localOnly: false,
        soulVersion: '1',
        catalogueHash: 'h',
        ...(external ? { external } : {}),
      },
    },
    {
      type: 'tool.requested',
      payload: {
        toolCallId,
        modelCallId: 'm1',
        modelToolCallId: 't1',
        tool: 'vision.describe',
        callName: 'vision_describe',
        meta: false,
        input: {},
        sideEffect: 'external',
      },
    },
    {
      type: 'approval.requested',
      payload: {
        requestId: 'consent-1',
        kind: 'consent',
        toolCallIds: [toolCallId],
        reason: 'upload',
        upload: { modules: ['vision'], providers: ['openai'], files: ['/clips/a.mov'] },
      },
    },
    {
      type: 'approval.requested',
      payload: {
        requestId: 'cap-1',
        kind: 'budget',
        toolCallIds: [],
        reason: 'projectCap',
        limit: 'projectCap',
        used: 1.5,
        max: 2,
        estimate: { usd: 0.8, tokens: 0 },
        projectId: newId<'Project'>(),
      },
    },
    { type: 'approval.granted', payload: { requestId: 'consent-1' } },
    { type: 'approval.denied', payload: { requestId: 'cap-1' } },
  ] as Omit<AgentEvent, 'runId' | 'seq' | 'v' | 'at'>[];
  return events.map((event, seq) => ({ ...event, runId, seq, v: 1, at: 1_000 + seq }) as AgentEvent);
}

function cards(events: readonly AgentEvent[]) {
  const translator = new RunTranslator(runId, () => 0);
  return events
    .flatMap((event) => translator.logged(event))
    .flatMap((event: ChatEvent) => (event.type === 'agent.card' ? [event.payload.card] : []))
    .filter((card) => card.type === 'consent' || card.type === 'budgetCap');
}

describe("an external agent's consent and project-cap cards", () => {
  it('say which external agent asked, pending and answered', () => {
    const shown = cards(log({ sessionId, name: 'Claude Code on this Mac', client: 'claude-code' }));
    expect(shown.map((card) => [card.type, card.status])).toEqual([
      ['consent', 'pending'],
      ['budgetCap', 'pending'],
      ['consent', 'approved'],
      ['budgetCap', 'stopped'],
    ]);
    for (const card of shown)
      expect(card).toMatchObject({ requester: { kind: 'mcp', sessionId, name: 'Claude Code on this Mac' } });
  });

  it("cut the session's name to the card's 60 characters", () => {
    const [card] = cards(log({ sessionId, name: 'x'.repeat(80), client: 'cli' }));
    expect(card).toMatchObject({ requester: { name: 'x'.repeat(60) } });
  });

  it("carry none for the agent's own run, or for a logged session that isn't an id", () => {
    for (const external of [undefined, { sessionId: 'not-an-id', name: 'Odd', client: 'cli' }])
      for (const card of cards(log(external))) expect(card).not.toHaveProperty('requester');
  });
});
