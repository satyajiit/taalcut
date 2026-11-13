// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineCommand, ok, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { nameFromChat, nameFromChatAsUndoStep, namingProject, restarted } from './project-naming-support';
import { ui } from './setup';

/** A change in the project's own history that reverses itself: it stands in for an edit of the video. */
const edit = defineCommand({
  name: 'test.edit',
  payload: z.object({ projectId: z.string() }),
  sideEffect: 'write',
  handle: (payload) => ok({ result: null, inverse: { name: 'test.edit', payload } }),
});

describe('automatic project naming', () => {
  it('follows its original chat title without moving the project up the recent list', async () => {
    const setup = await namingProject();
    const before = unwrap(setup.repos.projects.get(setup.projectId));
    const newer = unwrap(setup.repos.projects.create({ name: 'A newer project' }));
    unwrap(await nameFromChat(setup));
    expect(unwrap(setup.repos.projects.get(setup.projectId))).toMatchObject({
      name: 'Airport reel',
      updatedAt: before.updatedAt,
    });
    unwrap(setup.repos.conversations.setTitle(setup.conversation.id, 'Airport departure reel'));
    unwrap(await nameFromChat(setup, { name: 'Airport departure reel' }));
    expect(unwrap(setup.repos.projects.get(setup.projectId))).toMatchObject({
      name: 'Airport departure reel',
      updatedAt: before.updatedAt,
    });
    expect(setup.repos.projects.list().map((project) => project.id)).toEqual([newer.id, setup.projectId]);
  });

  it('is not an undo step: the next undo stays the change made before it', async () => {
    const setup = await namingProject();
    setup.bus.register(edit);
    unwrap(await setup.bus.dispatch(edit, { projectId: setup.projectId }, ui, { group: 'turn:run' }));
    expect(unwrap(await nameFromChat(setup)).undoable).toBe(false);
    const next = { undo: edit.name, undoGroup: 'turn:run' };
    expect(unwrap(await setup.bus.history(setup.projectId))).toMatchObject(next);
    expect(unwrap(await setup.bus.undo(setup.projectId, ui))).toMatchObject({
      name: edit.name,
      group: 'turn:run',
    });
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('Airport reel');
  });

  it('with nothing else to undo, undo leaves an automatic name alone', async () => {
    const setup = await namingProject();
    unwrap(await nameFromChat(setup));
    expect(unwrap(await setup.bus.undo(setup.projectId, ui))).toBeNull();
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('Airport reel');
  });

  it('an older history’s automatic name: undoing it opts out until it is deliberately redone', async () => {
    const first = await namingProject();
    await nameFromChatAsUndoStep(first);
    const setup = restarted(first);
    unwrap(await setup.bus.undo(setup.projectId, ui));
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('New project');
    const refused = await nameFromChat(setup);
    expect(!refused.ok && refused.error.code).toBe('core.conflict');
    expect(unwrap(setup.repos.auditLog.listByProject(setup.projectId))).toHaveLength(1);
    unwrap(await setup.bus.redo(setup.projectId, ui));
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('Airport reel');
    unwrap(setup.repos.conversations.setTitle(setup.conversation.id, 'Airport departure reel'));
    unwrap(await nameFromChat(setup, { name: 'Airport departure reel' }));
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('Airport departure reel');
  });

  it('keeps a manual rename as an opt-out even after the person undoes it', async () => {
    const setup = await namingProject();
    unwrap(
      await setup.bus.dispatch(setup.commands.rename, { projectId: setup.projectId, name: 'My cut' }, ui),
    );
    unwrap(await setup.bus.undo(setup.projectId, ui));
    const refused = await nameFromChat(setup);
    expect(!refused.ok && refused.error.code).toBe('core.conflict');
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('New project');
    unwrap(await setup.bus.redo(setup.projectId, ui));
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('My cut');
  });

  it('an older history replays its automatic names in order while later names are still undone', async () => {
    const first = await namingProject();
    await nameFromChatAsUndoStep(first);
    unwrap(first.repos.conversations.setTitle(first.conversation.id, 'Airport departure reel'));
    await nameFromChatAsUndoStep(first, { name: 'Airport departure reel' });
    const setup = restarted(first);
    unwrap(await setup.bus.undo(setup.projectId, ui));
    unwrap(await setup.bus.undo(setup.projectId, ui));
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('New project');
    const refused = await nameFromChat(setup, { name: 'Airport departure reel' });
    expect(!refused.ok && refused.error.code).toBe('core.conflict');
    unwrap(await setup.bus.redo(setup.projectId, ui));
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('Airport reel');
    unwrap(await setup.bus.redo(setup.projectId, ui));
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('Airport departure reel');
    expect(unwrap(setup.repos.auditLog.listByProject(setup.projectId))).toHaveLength(2);
  });

  it('an older history’s explicit redo restores its name after the chat gets a newer title', async () => {
    const first = await namingProject();
    await nameFromChatAsUndoStep(first);
    const setup = restarted(first);
    unwrap(await setup.bus.undo(setup.projectId, ui));
    unwrap(setup.repos.conversations.setTitle(setup.conversation.id, 'Airport departure reel'));
    const refused = await nameFromChat(setup, { name: 'Airport departure reel' });
    expect(!refused.ok && refused.error.code).toBe('core.conflict');
    unwrap(await setup.bus.redo(setup.projectId, ui));
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('Airport reel');
    expect(unwrap(setup.repos.conversations.get(setup.conversation.id)).title).toBe('Airport departure reel');
    unwrap(await nameFromChat(setup, { name: 'Airport departure reel' }));
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('Airport departure reel');
  });

  it.each([
    { source: 'ui', actor: 'user' },
    { source: 'agent', actor: 'agent:other' },
  ] as const)('refuses a project created by $actor', async (origin) => {
    const setup = await namingProject(origin);
    const refused = await nameFromChat(setup);
    expect(!refused.ok && refused.error.code).toBe('core.conflict');
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('New project');
    expect(unwrap(setup.repos.auditLog.listByProject(setup.projectId))).toEqual([]);
  });

  it('refuses projects without an audited flow creation and unexpected stored names', async () => {
    const setup = await namingProject();
    const ordinary = unwrap(setup.repos.projects.create({ name: 'New project' }));
    const unproven = await nameFromChat({ ...setup, projectId: ordinary.id });
    expect(!unproven.ok && unproven.error.code).toBe('core.conflict');
    unwrap(setup.repos.projects.rename(setup.projectId, 'Imported name'));
    const renamed = await nameFromChat(setup);
    expect(!renamed.ok && renamed.error.code).toBe('core.conflict');
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('Imported name');
  });

  it('keeps the first chat as owner even if it is deleted, and rejects stale title callbacks', async () => {
    const setup = await namingProject();
    const later = unwrap(
      setup.repos.conversations.create({ projectId: setup.projectId, title: 'Airport reel' }),
    );
    const wrongChat = await nameFromChat(setup, { conversationId: later.id });
    expect(!wrongChat.ok && wrongChat.error.code).toBe('core.conflict');
    unwrap(setup.repos.chat.remove(setup.conversation.id));
    const deleted = await nameFromChat(setup);
    const replacement = await nameFromChat(setup, { conversationId: later.id });
    expect(!deleted.ok && deleted.error.code).toBe('core.conflict');
    expect(!replacement.ok && replacement.error.code).toBe('core.conflict');
    unwrap(setup.repos.chat.restore(setup.conversation.id));
    unwrap(setup.repos.conversations.setTitle(setup.conversation.id, 'A newer chat title'));
    const stale = await nameFromChat(setup);
    expect(!stale.ok && stale.error.code).toBe('core.conflict');
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('New project');
    expect(unwrap(setup.repos.auditLog.listByProject(setup.projectId))).toEqual([]);
    expect(setup.seen).toHaveLength(1); // Only the original project creation was committed.
  });

  it('refuses archived projects and automatic mode from an ordinary rename caller', async () => {
    const setup = await namingProject();
    const wrongOrigin = await setup.bus.dispatch(
      setup.commands.rename,
      { projectId: setup.projectId, name: 'Airport reel', fromConversation: setup.conversation.id },
      ui,
    );
    expect(!wrongOrigin.ok && wrongOrigin.error.code).toBe('core.conflict');
    unwrap(setup.repos.projects.archive(setup.projectId));
    const archived = await nameFromChat(setup);
    expect(!archived.ok && archived.error.code).toBe('core.conflict');
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('New project');
  });
});
