// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-WS: WORKSPACE_COMMANDS on core's bus over the library's ports. A write makes the next revision; undo
 * restores the base, together with a timeline edit of the same agent turn; redo brings the same revision back; a
 * write on a stale base is refused with the head as it is now; the audit log keeps paths and hashes, never text.
 */
import { agentTurnGroup, newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { agent, code, filesAtHead, person, setup, W, withProject, writeFiles } from './workspace-setup';

describe('workspace commands (HFW1-WS)', () => {
  it('write, delete, and undo and redo each to the same revisions', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    const first = unwrap(await writeFiles(world, projectId, { 'card/index.html': '<div>a</div>' }));
    expect(first.result).toEqual({ projectId, revision: 1 });
    expect(first.undoable).toBe(true);
    unwrap(
      await writeFiles(world, projectId, { 'card/style.css': '.a{}', 'card/index.html': '<div>b</div>' }),
    );
    unwrap(await writeFiles(world, projectId, { 'card/style.css': null }));
    expect(await filesAtHead(world, projectId)).toEqual({ 'card/index.html': '<div>b</div>' });
    const head = unwrap(await world.store.head(projectId))!;
    expect(head).toMatchObject({ revision: 3, base: 2, origin: 'agent' });

    unwrap(await world.bus.undo(projectId, person));
    expect(world.store.position(projectId)).toEqual({ head: 2, latest: 3 });
    unwrap(await world.bus.undo(projectId, person));
    unwrap(await world.bus.undo(projectId, person));
    expect(unwrap(await world.store.head(projectId))).toBeNull();
    unwrap(await world.bus.redo(projectId, person));
    unwrap(await world.bus.redo(projectId, person));
    // Redone writes are the revisions they made the first time, not new ones.
    expect(world.store.position(projectId)).toEqual({ head: 2, latest: 3 });
    expect(await filesAtHead(world, projectId)).toEqual({
      'card/index.html': '<div>b</div>',
      'card/style.css': '.a{}',
    });
  });

  it('take the files back with the timeline edit of the same agent turn, as one step', async () => {
    const world = await setup();
    const { projectId, timelineId } = await withProject(world);
    unwrap(await writeFiles(world, projectId, { 'notes.txt': 'before the turn' }));
    const group = agentTurnGroup(newId<'AgentRun'>());
    unwrap(await writeFiles(world, projectId, { 'card/index.html': '<p>one</p>' }, { group }));
    unwrap(
      await world.bus.dispatch(world.rename, { projectId, timelineId, name: 'Designed' }, agent, { group }),
    );
    unwrap(await writeFiles(world, projectId, { 'card/index.html': '<p>two</p>' }, { group }));
    expect(unwrap(await world.bus.history(projectId)).undoGroup).toBe(group);

    const undone = unwrap(await world.bus.undo(projectId, person, { group }))!;
    expect(undone).toMatchObject({ group, steps: 3 });
    expect(await filesAtHead(world, projectId)).toEqual({ 'notes.txt': 'before the turn' });
    expect(unwrap(await world.timelines.get(timelineId)).summary.name).toBe('Goa, variant 1');

    const redone = unwrap(await world.bus.redo(projectId, person))!;
    expect(redone).toMatchObject({ group, steps: 3 });
    expect(await filesAtHead(world, projectId)).toMatchObject({ 'card/index.html': '<p>two</p>' });
    expect(unwrap(await world.timelines.get(timelineId)).summary.name).toBe('Designed');
    expect(world.store.position(projectId)).toEqual({ head: 3, latest: 3 });
  });

  it('refuse a write on a stale base with the head as it is now, also when two race', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    unwrap(await writeFiles(world, projectId, { 'a.css': '.a{}' }));
    const stale = await writeFiles(world, projectId, { 'b.css': '.b{}' }, { base: 0 });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error).toMatchObject({
      code: 'core.conflict',
      params: { entity: 'workspaceRevision', id: '1' },
    });

    // Two writes made on the same head: the bus runs them one after the other, and the second is stale.
    const put = async (content: string) =>
      unwrap(await world.store.putBlob(projectId, new TextEncoder().encode(content)));
    const [x, y] = [await put('x'), await put('y')];
    const race = await Promise.all([
      world.bus.dispatch(
        W.writeFiles,
        { projectId, baseRevision: 1, files: [{ path: 'x', sha256: x.sha256 }] },
        agent,
      ),
      world.bus.dispatch(
        W.writeFiles,
        { projectId, baseRevision: 1, files: [{ path: 'y', sha256: y.sha256 }] },
        agent,
      ),
    ]);
    expect(race.map(code)).toEqual(['ok', 'core.conflict']);
    expect(race[1]!.ok ? null : race[1]!.error.params).toEqual({ entity: 'workspaceRevision', id: '2' });
    expect(Object.keys(await filesAtHead(world, projectId))).toEqual(['a.css', 'x']);
  });

  it('refuse a file whose bytes are not in the store, and deleting a file that is not there', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    const missing = await world.bus.dispatch(
      W.writeFiles,
      { projectId, baseRevision: 0, files: [{ path: 'a.css', sha256: 'e'.repeat(64) }] },
      agent,
    );
    expect(missing.ok ? null : missing.error).toMatchObject({
      code: 'core.not_found',
      params: { entity: 'workspaceBlob' },
    });
    expect(code(await writeFiles(world, projectId, { 'gone.css': null }))).toBe('core.not_found');
    const other = await withProject(world);
    const elsewhere = unwrap(await world.store.putBlob(other.projectId, new TextEncoder().encode('.o{}')));
    // A blob is its project's: another project's bytes aren't in this workspace.
    const borrowed = await world.bus.dispatch(
      W.writeFiles,
      { projectId, baseRevision: 0, files: [{ path: 'o.css', sha256: elsewhere.sha256 }] },
      agent,
    );
    expect(code(borrowed)).toBe('core.not_found');
    expect(unwrap(await world.store.head(projectId))).toBeNull();
  });

  it('change nothing when the files are already so: no revision, nothing to undo', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    unwrap(await writeFiles(world, projectId, { 'a.css': '.a{}' }));
    const again = unwrap(await writeFiles(world, projectId, { 'a.css': '.a{}' }));
    expect(again).toMatchObject({ result: { projectId, revision: 1 }, undoable: false });
    expect(world.store.position(projectId)).toEqual({ head: 1, latest: 1 });
  });

  it('keep paths and hashes in the audit log, never a file’s text', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    const secret = 'the words of a made-up message bubble';
    unwrap(await writeFiles(world, projectId, { 'bubble/index.html': `<p>${secret}</p>` }));
    const rows = world.db.driver.prepare("SELECT * FROM commands WHERE name LIKE 'workspace.%'").all();
    expect(rows).toHaveLength(1);
    const logged = JSON.stringify(rows);
    expect(logged).not.toContain(secret);
    const head = unwrap(await world.store.head(projectId))!;
    expect(logged).toContain('bubble/index.html');
    expect(logged).toContain(head.files[0]!.sha256);
    expect(JSON.stringify(world.db.driver.prepare('SELECT * FROM workspace_revisions').all())).not.toContain(
      secret,
    );
  });

  it('restore from the files viewer: a person goes back to a revision, audited, and ⌘Z takes it back', async () => {
    const world = await setup();
    const { projectId } = await withProject(world);
    unwrap(await writeFiles(world, projectId, { 'a.css': '.a{}' }));
    unwrap(await writeFiles(world, projectId, { 'b.css': '.b{}' }));
    expect(code(await world.bus.dispatch(W.restore, { projectId, revision: 9 }, person))).toBe(
      'core.not_found',
    );
    const restored = unwrap(await world.bus.dispatch(W.restore, { projectId, revision: 1 }, person));
    expect(restored).toMatchObject({ result: { projectId, revision: 1 }, undoable: true });
    expect(Object.keys(await filesAtHead(world, projectId))).toEqual(['a.css']);
    const logged = world.db.driver
      .prepare("SELECT source, payload FROM commands WHERE name = 'workspace.restore'")
      .all();
    expect(logged).toEqual([{ source: 'ui', payload: JSON.stringify({ projectId, revision: 1 }) }]);
    // The viewer lists every revision, newest first, with the head where it is now.
    const listed = unwrap(await world.store.revisions(projectId, 10));
    expect(listed.map((revision) => revision.revision)).toEqual([2, 1]);
    expect(unwrap(await world.store.revisions(projectId, 1))).toHaveLength(1);
    expect(world.store.position(projectId)).toEqual({ head: 1, latest: 2 });

    unwrap(await world.bus.undo(projectId, person));
    expect(Object.keys(await filesAtHead(world, projectId))).toEqual(['a.css', 'b.css']);
    unwrap(await world.bus.redo(projectId, person));
    expect(Object.keys(await filesAtHead(world, projectId))).toEqual(['a.css']);
    // A write over the restored head is the next revision, written over 1.
    const later = unwrap(await writeFiles(world, projectId, { 'c.css': '.c{}' }));
    expect(later.result).toMatchObject({ revision: 3 });
    expect(unwrap(await world.store.head(projectId))).toMatchObject({ revision: 3, base: 1 });
  });

  it('refuse a project that is not in the library', async () => {
    const world = await setup();
    const projectId = newId<'Project'>();
    expect(code(await world.store.putBlob(projectId, new Uint8Array([1])))).toBe('core.not_found');
    const payload = { projectId, baseRevision: 0, files: [{ path: 'a.css', delete: true }] };
    expect(code(await world.bus.dispatch(W.writeFiles, payload, agent))).toBe('core.not_found');
  });
});
