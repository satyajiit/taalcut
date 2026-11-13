// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { unwrap } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { automatic, nameFromChat, namingProject } from './project-naming-support';
import { projectsSetup, ui } from './setup';

describe('project naming at staged commit', () => {
  it.each([false, true])('rejects a manual rename from another bus, undone=%s', async (undo) => {
    const setup = await namingProject();
    const other = projectsSetup(setup.db);
    let staged!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (staged = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const append = setup.ports.auditLog.append;
    vi.spyOn(setup.ports.auditLog, 'append').mockImplementationOnce(async (entry) => {
      staged();
      await released;
      return append(entry);
    });
    const pending = nameFromChat(setup);
    await waiting;
    try {
      unwrap(
        await other.bus.dispatch(other.commands.rename, { projectId: setup.projectId, name: 'My cut' }, ui),
      );
      if (undo) unwrap(await other.bus.undo(setup.projectId, ui));
    } finally {
      release();
    }
    const refused = await pending;
    expect(!refused.ok && refused.error.code).toBe('core.conflict');
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe(undo ? 'New project' : 'My cut');
    expect(unwrap(setup.repos.auditLog.listByProject(setup.projectId))).toHaveLength(1);
    expect(setup.seen).toHaveLength(1); // The stale bus never announces its rejected rename.
  });

  it('rechecks expectedName at commit even without automatic naming policy', async () => {
    const setup = projectsSetup();
    const other = projectsSetup(setup.db);
    const project = unwrap(setup.repos.projects.create({ name: 'New project' }));
    const append = setup.ports.auditLog.append;
    vi.spyOn(setup.ports.auditLog, 'append').mockImplementationOnce(async (entry) => {
      unwrap(await other.bus.dispatch(other.commands.rename, { projectId: project.id, name: 'My cut' }, ui));
      return append(entry);
    });
    const refused = await setup.bus.dispatch(
      setup.commands.rename,
      { projectId: project.id, name: 'Airport reel', expectedName: 'New project' },
      automatic,
    );
    expect(!refused.ok && refused.error.code).toBe('core.conflict');
    expect(unwrap(setup.repos.projects.get(project.id)).name).toBe('My cut');
    expect(unwrap(setup.repos.auditLog.listByProject(project.id))).toHaveLength(1);
    expect(setup.seen).toEqual([]);
  });

  it('rechecks the chat title after a callback was already queued', async () => {
    const setup = await namingProject();
    const append = setup.ports.auditLog.append;
    vi.spyOn(setup.ports.auditLog, 'append').mockImplementationOnce(async (entry) => {
      unwrap(setup.repos.conversations.setTitle(setup.conversation.id, 'A newer chat title'));
      return append(entry);
    });
    const refused = await nameFromChat(setup);
    expect(!refused.ok && refused.error.code).toBe('core.conflict');
    expect(unwrap(setup.repos.projects.get(setup.projectId)).name).toBe('New project');
    expect(unwrap(setup.repos.auditLog.listByProject(setup.projectId))).toEqual([]);
  });
});
