// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-WS: a restart keeps the workspace. The revisions, the head and the blobs are on disk, and the bus, rebuilt
 * from the audit log, still undoes and redoes the agent's turn with them.
 */
import { agentTurnGroup, newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { filesAtHead, person, setup, withProject, writeFiles } from './workspace-setup';

describe('workspace across a restart (HFW1-WS)', () => {
  it('keep the revisions and the head, and undo and redo the turn after it', async () => {
    const first = await setup();
    const { projectId, timelineId } = await withProject(first);
    unwrap(await writeFiles(first, projectId, { 'card/index.html': '<p>one</p>' }));
    const group = agentTurnGroup(newId<'AgentRun'>());
    unwrap(
      await writeFiles(
        first,
        projectId,
        { 'card/index.html': '<p>two</p>', 'card/a.css': '.a{}' },
        { group },
      ),
    );
    unwrap(
      await first.bus.dispatch(first.rename, { projectId, timelineId, name: 'Designed' }, person, { group }),
    );
    const before = unwrap(await first.store.head(projectId));
    first.db.close();

    const second = await setup({ dataRoot: first.dataRoot });
    expect(unwrap(await second.store.head(projectId))).toEqual(before);
    expect(unwrap(await second.store.revision(projectId, 1)).files.map((file) => file.path)).toEqual([
      'card/index.html',
    ]);
    expect(await filesAtHead(second, projectId)).toEqual({
      'card/a.css': '.a{}',
      'card/index.html': '<p>two</p>',
    });

    const undone = unwrap(await second.bus.undo(projectId, person))!;
    expect(undone).toMatchObject({ group, steps: 2 });
    expect(await filesAtHead(second, projectId)).toEqual({ 'card/index.html': '<p>one</p>' });
    unwrap(await second.bus.redo(projectId, person));
    expect(second.store.position(projectId)).toEqual({ head: 2, latest: 2 });
    expect(unwrap(await second.timelines.get(timelineId)).summary.name).toBe('Designed');
  });
});
