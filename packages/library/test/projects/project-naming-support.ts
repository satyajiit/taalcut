// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { unwrap, type CommandOrigin, type ConversationId, type ProjectId } from '@taalcut/core';
import { eq } from 'drizzle-orm';
import { commands } from '../../src/schema/audit';
import { projectsSetup } from './setup';

export const automatic: CommandOrigin = { source: 'agent', actor: 'agent:project-title' };

export async function namingProject(origin: CommandOrigin = { source: 'agent', actor: 'agent:flow' }) {
  const setup = projectsSetup();
  const created = unwrap(await setup.bus.dispatch(setup.commands.create, { name: 'New project' }, origin));
  const projectId = (created.result as { projectId: ProjectId }).projectId;
  const conversation = unwrap(setup.repos.conversations.create({ projectId, title: 'Airport reel' }));
  return { ...setup, projectId, conversation };
}

type NamingSetup = Awaited<ReturnType<typeof namingProject>>;
interface NameOptions {
  name?: string;
  expectedName?: string;
  conversationId?: ConversationId;
}

/**
 * An automatic name as histories recorded it while it still was an undo step: the same audit row, with the rename
 * back as its inverse. Read it with `restarted`; the bus that made it already has its own history.
 */
export async function nameFromChatAsUndoStep(setup: NamingSetup, options: NameOptions = {}) {
  const before = unwrap(setup.repos.projects.get(setup.projectId)).name;
  const named = unwrap(await nameFromChat(setup, options));
  const inverse = { name: setup.commands.rename.name, payload: { projectId: setup.projectId, name: before } };
  setup.db.orm.update(commands).set({ inverse }).where(eq(commands.id, named.id)).run();
}

/** The same database behind a new bus, which reads its history from the log as the app does when it starts. */
export function restarted(setup: NamingSetup): NamingSetup {
  return { ...projectsSetup(setup.db), projectId: setup.projectId, conversation: setup.conversation };
}

export function nameFromChat(setup: NamingSetup, options: NameOptions = {}) {
  return setup.bus.dispatch(
    setup.commands.rename,
    {
      projectId: setup.projectId,
      name: options.name ?? 'Airport reel',
      expectedName: options.expectedName ?? unwrap(setup.repos.projects.get(setup.projectId)).name,
      fromConversation: options.conversationId ?? setup.conversation.id,
    },
    automatic,
  );
}
