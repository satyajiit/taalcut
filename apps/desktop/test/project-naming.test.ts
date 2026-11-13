// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_TURN_GROUP_PREFIX,
  BUDGET_COMMANDS,
  CommandBusToken,
  ConversationStoreToken,
  PROJECT_COMMANDS,
  unwrap,
  type Container,
  type ProjectId,
} from '@taalcut/core';
import { createRepositories } from '@taalcut/library';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { agentFlowDeps } from '../src/utility/roots/agent-flows';
import { repairFlowProjectNames, syncConversationProjectName } from '../src/utility/roots/project-naming';
import { testAgent, testConfig } from './helpers/roots';

const open: Container[] = [];
afterEach(async () => {
  for (const container of open.splice(0)) await container.dispose();
});

const user = { source: 'ui', actor: 'user' } as const;
const flow = { source: 'agent', actor: 'agent:flow' } as const;
const request = 'lets create from https://example.test/reference?tracking=long , use airport shots';

async function world(title = 'Airport Reel With City Lights', automatic = true) {
  const { container } = testAgent(testConfig('agent'));
  open.push(container);
  const bus = container.resolve(CommandBusToken);
  const conversations = container.resolve(ConversationStoreToken);
  const repos = createRepositories(container.resolve(LibraryDatabaseToken));
  const created = unwrap(
    await bus.dispatch(PROJECT_COMMANDS.create, { name: request.slice(0, 80) }, automatic ? flow : user),
  );
  const projectId = (created.result as { projectId: ProjectId }).projectId;
  const conversation = unwrap(await conversations.create({ projectId, title }));
  unwrap(
    await conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      parts: [{ type: 'text', text: request }],
    }),
  );
  return { container, bus, conversations, repos, projectId, conversationId: conversation.id };
}

describe('automatic project names', () => {
  it('repairs an old flow project from its existing chat title once, without reordering it', async () => {
    const w = await world();
    const before = unwrap(w.repos.projects.get(w.projectId));
    await repairFlowProjectNames(w.container);
    const named = unwrap(w.repos.projects.get(w.projectId));
    expect(named.name).toBe('Airport Reel With City Lights');
    expect(named.updatedAt).toBe(before.updatedAt);
    await repairFlowProjectNames(w.container);
    expect(unwrap(w.repos.auditLog.listByProject(w.projectId))).toHaveLength(1);
  });

  it('follows a later generated title and ignores stale callbacks', async () => {
    const w = await world();
    await syncConversationProjectName(w.container, w.conversationId, 'Airport Reel With City Lights');
    unwrap(await w.conversations.rename(w.conversationId, 'Airport Lights at Night'));
    await syncConversationProjectName(w.container, w.conversationId, 'Airport Reel With City Lights');
    expect(unwrap(w.repos.projects.get(w.projectId)).name).toBe('Airport Reel With City Lights');
    await syncConversationProjectName(w.container, w.conversationId, 'Airport Lights at Night');
    expect(unwrap(w.repos.projects.get(w.projectId)).name).toBe('Airport Lights at Night');
  });

  it('leaves the chat’s turn as the next undo: an automatic name is not an undo step', async () => {
    const w = await world();
    const group = `${AGENT_TURN_GROUP_PREFIX}run`;
    const cap = { projectId: w.projectId, cap: null };
    unwrap(await w.bus.dispatch(BUDGET_COMMANDS.setProjectCap, cap, user, { group }));
    await syncConversationProjectName(w.container, w.conversationId, 'Airport Reel With City Lights');
    expect(unwrap(w.repos.projects.get(w.projectId)).name).toBe('Airport Reel With City Lights');
    expect(unwrap(await w.bus.history(w.projectId))).toMatchObject({
      undo: BUDGET_COMMANDS.setProjectCap,
      undoGroup: group,
    });
  });

  it('keeps manual project names, and undo leaves an automatic name alone', async () => {
    const w = await world();
    await repairFlowProjectNames(w.container);
    expect(unwrap(await w.bus.undo(w.projectId, user))).toBeNull();
    await repairFlowProjectNames(w.container);
    expect(unwrap(w.repos.projects.get(w.projectId)).name).toBe('Airport Reel With City Lights');
    unwrap(
      await w.bus.dispatch(PROJECT_COMMANDS.rename, { projectId: w.projectId, name: 'My final cut' }, user),
    );
    await syncConversationProjectName(w.container, w.conversationId, 'Airport Reel With City Lights');
    expect(unwrap(w.repos.projects.get(w.projectId)).name).toBe('My final cut');
  });

  it('does not adopt manually created projects even when their names look automatic', async () => {
    const w = await world('Airport Reel With City Lights', false);
    await repairFlowProjectNames(w.container);
    expect(unwrap(w.repos.projects.get(w.projectId)).name).toBe(request.slice(0, 80));
    expect(unwrap(w.repos.auditLog.listByProject(w.projectId))).toHaveLength(0);
  });

  it('waits for a descriptive chat title instead of copying a raw URL fallback', async () => {
    const w = await world(request.slice(0, 48));
    await repairFlowProjectNames(w.container);
    expect(unwrap(w.repos.projects.get(w.projectId)).name).toBe(request.slice(0, 80));
    expect(unwrap(w.repos.auditLog.listByProject(w.projectId))).toHaveLength(0);
  });

  it('names a newly linked flow project when the chat was already titled', async () => {
    const w = await world();
    const conversation = unwrap(await w.conversations.create({ title: 'Airport Departure Reel' }));
    const projects = agentFlowDeps(w.container).projects!;
    const projectId = unwrap(await projects.forConversation(conversation.id, { name: 'Create this video' }));
    expect(unwrap(w.repos.projects.get(projectId as ProjectId)).name).toBe('Airport Departure Reel');
  });
});
