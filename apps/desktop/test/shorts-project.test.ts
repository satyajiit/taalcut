// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConversationStoreToken,
  createContainer,
  EventBusToken,
  EventLogStoreToken,
  newId,
  ok,
  unwrap,
  type CommandToolContext,
  type ConversationStore,
  type EventBus,
  type EventLogStore,
} from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { shortsProjectTool } from '../src/utility/roots/shorts-project';

function setup(existing = false) {
  const runId = newId<'AgentRun'>();
  const conversationId = newId<'Conversation'>();
  const previous = newId<'Project'>();
  const setProject = vi.fn(async () => ok(undefined));
  const emit = vi.fn();
  const dispatch = vi.fn(async (input: unknown) =>
    ok({ projectId: (input as { projectId: string }).projectId }),
  );
  const container = createContainer()
    .value(EventLogStoreToken, {
      listRuns: async () => ok([{ runId, conversationId }]),
    } as unknown as EventLogStore)
    .value(ConversationStoreToken, {
      get: async () => ok({ conversation: { projectId: existing ? previous : null } }),
      setProject,
    } as unknown as ConversationStore)
    .value(EventBusToken, { emit } as unknown as EventBus);
  const ctx: CommandToolContext = {
    callId: newId<'ToolRun'>(),
    runId,
    attempt: 1,
    signal: new AbortController().signal,
    dispatch,
    reportUsage: vi.fn(),
    reportProgress: vi.fn(),
    artifacts: { put: vi.fn(), get: vi.fn() },
  };
  return {
    tool: shortsProjectTool(container),
    ctx,
    setProject,
    emit,
    dispatch,
    runId,
    conversationId,
    previous,
  };
}

it('creates a stable project through the normal command and links the requesting chat', async () => {
  const s = setup();
  const result = unwrap(await s.tool.run({ name: 'The long-form short' }, s.ctx));
  expect(result.projectId).toBe(s.runId);
  expect(s.dispatch).toHaveBeenCalledWith({ name: 'The long-form short', projectId: s.runId });
  expect(s.setProject).toHaveBeenCalledWith(s.conversationId, result.projectId);
  expect(s.emit).toHaveBeenCalledWith('library.changed', expect.objectContaining({ entity: 'conversation' }));
});

it('reuses the conversation project without creating another on a follow-up request', async () => {
  const s = setup(true);
  expect(unwrap(await s.tool.run({ name: 'Another short' }, s.ctx)).projectId).toBe(s.previous);
  expect(s.dispatch).not.toHaveBeenCalled();
  expect(s.setProject).not.toHaveBeenCalled();
});
