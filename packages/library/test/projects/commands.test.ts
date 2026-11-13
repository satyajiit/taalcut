// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X3: the project commands on core's bus over the library's unit of work.
 * Create copies the default cap and is undone by archiving; archive and
 * unarchive undo each other; restoring a version is itself undoable
 * (restore → undo → redo) without piling up snapshots; changes are
 * announced only once committed.
 */
import { DEFAULT_PROJECT_CAP_SETTING, newId, unwrap, type ProjectId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createProjectBudgetStore } from '../../src/index';
import { edited } from '../stores/documents';
import { projectsSetup, projectWithTimeline, ui } from './setup';

const changed = (setup: ReturnType<typeof projectsSetup>) =>
  setup.seen.map((event) => {
    const { entity, change } = (event as { payload: { entity: string; change: string } }).payload;
    return `${entity}.${change}`;
  });

describe('project commands', () => {
  it('creates a project with the default cap; undo archives it and redo brings it back', async () => {
    const setup = projectsSetup();
    const { bus, repos, commands, ports, db } = setup;
    unwrap(await ports.settings.set(DEFAULT_PROJECT_CAP_SETTING, { currency: 'USD', micros: 3_000_000 }));
    const receipt = unwrap(await bus.dispatch(commands.create, { name: '  Goa trip ' }, ui));
    const id = (receipt.result as { projectId: ProjectId }).projectId;
    expect(id).toBe(receipt.id); // the command's id, so redo makes the same project
    expect(receipt.projectId).toBeNull(); // app-wide history
    expect(unwrap(repos.projects.get(id)).name).toBe('Goa trip');
    expect(unwrap(await createProjectBudgetStore(db).get(id)).cap).toEqual({
      currency: 'USD',
      micros: 3_000_000,
    });
    unwrap(await bus.undo(null, ui));
    expect(unwrap(repos.projects.get(id)).archivedAt).not.toBeNull();
    unwrap(await bus.redo(null, ui));
    expect(unwrap(repos.projects.get(id)).archivedAt).toBeNull();
    expect(changed(setup)).toEqual(['project.created', 'project.updated', 'project.updated']);
  });

  it('renames in the project’s own history; archive and unarchive undo each other', async () => {
    const setup = projectsSetup();
    const { bus, repos, commands } = setup;
    const project = unwrap(repos.projects.create({ name: 'Goa' }));
    unwrap(await bus.dispatch(commands.rename, { projectId: project.id, name: 'Goa 2026' }, ui));
    unwrap(await bus.undo(project.id, ui));
    expect(unwrap(repos.projects.get(project.id)).name).toBe('Goa');
    const archived = unwrap(await bus.dispatch(commands.archive, { projectId: project.id }, ui));
    expect(archived.undoable).toBe(true);
    expect(unwrap(repos.projects.get(project.id)).archivedAt).not.toBeNull();
    const again = unwrap(await bus.dispatch(commands.archive, { projectId: project.id }, ui));
    expect(again.undoable).toBe(false); // already archived: nothing to undo
    unwrap(await bus.dispatch(commands.unarchive, { projectId: project.id }, ui));
    expect(unwrap(repos.projects.get(project.id)).archivedAt).toBeNull();
    unwrap(await bus.undo(null, ui)); // undo the unarchive
    expect(unwrap(repos.projects.get(project.id)).archivedAt).not.toBeNull();
    const missing = await bus.dispatch(commands.archive, { projectId: newId<'Project'>() }, ui);
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
  });

  it('rejects a queued automatic rename after a person changes the expected project name', async () => {
    const setup = projectsSetup();
    const { bus, repos, commands } = setup;
    const project = unwrap(repos.projects.create({ name: 'New project' }));
    const [manual, automatic] = await Promise.all([
      bus.dispatch(commands.rename, { projectId: project.id, name: 'My airport cut' }, ui),
      bus.dispatch(
        commands.rename,
        { projectId: project.id, name: 'Airport reel', expectedName: 'New project' },
        { source: 'agent', actor: 'project-title' },
      ),
    ]);
    expect(manual.ok).toBe(true);
    expect(!automatic.ok && automatic.error.code).toBe('core.conflict');
    expect(unwrap(repos.projects.get(project.id)).name).toBe('My airport cut');
    expect(unwrap(repos.auditLog.listByProject(project.id))).toHaveLength(1);
    expect(changed(setup)).toEqual(['project.updated']);
    unwrap(await bus.undo(project.id, ui));
    expect(unwrap(repos.projects.get(project.id)).name).toBe('New project');
    unwrap(await bus.redo(project.id, ui));
    expect(unwrap(repos.projects.get(project.id)).name).toBe('My airport cut');
  });

  it('renames a matching expected name and keeps its undo and redo behavior', async () => {
    const setup = projectsSetup();
    const { bus, repos, commands } = setup;
    const project = unwrap(repos.projects.create({ name: 'New project' }));
    unwrap(
      await bus.dispatch(
        commands.rename,
        { projectId: project.id, name: 'Airport reel', expectedName: 'New project' },
        { source: 'agent', actor: 'project-title' },
      ),
    );
    expect(unwrap(repos.projects.get(project.id)).name).toBe('Airport reel');
    unwrap(await bus.undo(project.id, ui));
    expect(unwrap(repos.projects.get(project.id)).name).toBe('New project');
    unwrap(await bus.redo(project.id, ui));
    expect(unwrap(repos.projects.get(project.id)).name).toBe('Airport reel');
    expect(changed(setup)).toEqual(Array(3).fill('project.updated'));
  });

  it('restore → undo → redo: the working copy goes back and forth, snapshots don’t pile up', async () => {
    const setup = projectsSetup();
    const { bus, commands, timelines } = setup;
    const { project, doc } = await projectWithTimeline(setup);
    const v1 = unwrap(timelines.versions.list(doc.id)).items[0]!; // the assembly's auto version
    unwrap(await timelines.put(edited(doc, 90), 1)); // the user edits: revision 2, 180 frames
    const duration = async () => unwrap(await timelines.get(doc.id)).summary.duration.value;
    const kinds = () => unwrap(timelines.versions.list(doc.id)).items.map((v) => v.kind);
    expect(await duration()).toBe(180);

    const restored = unwrap(
      await bus.dispatch(
        commands.restoreVersion,
        { projectId: project.id, timelineId: doc.id, versionId: v1.id },
        ui,
      ),
    );
    const before = (restored.result as { beforeVersionId: string }).beforeVersionId;
    expect(before).toBe(restored.id); // the snapshot's id is the command's
    expect([await duration(), unwrap(await timelines.get(doc.id)).summary.revision]).toEqual([150, 3]);
    expect(kinds()).toEqual(['before-restore', 'auto']);

    unwrap(await bus.undo(project.id, ui));
    expect([await duration(), unwrap(await timelines.get(doc.id)).summary.revision]).toEqual([180, 4]);
    unwrap(await bus.redo(project.id, ui));
    expect([await duration(), unwrap(await timelines.get(doc.id)).summary.revision]).toEqual([150, 5]);
    unwrap(await bus.undo(project.id, ui));
    expect(await duration()).toBe(180);
    expect(kinds()).toEqual(['before-restore', 'auto']); // no new snapshots
    expect(changed(setup)).toEqual(Array(4).fill('timeline.updated'));
  });

  it('restoring the version the timeline already shows changes nothing', async () => {
    const setup = projectsSetup();
    const { bus, commands, timelines } = setup;
    const { project, doc } = await projectWithTimeline(setup);
    const v1 = unwrap(timelines.versions.list(doc.id)).items[0]!;
    const receipt = unwrap(
      await bus.dispatch(
        commands.restoreVersion,
        { projectId: project.id, timelineId: doc.id, versionId: v1.id },
        ui,
      ),
    );
    expect(receipt.undoable).toBe(false);
    expect(unwrap(await timelines.get(doc.id)).summary.revision).toBe(1);
  });

  it('refuses a version or timeline of another project, and a stale restore changes nothing', async () => {
    const setup = projectsSetup();
    const { bus, commands, timelines } = setup;
    const { project, doc } = await projectWithTimeline(setup);
    const other = await projectWithTimeline(setup);
    const v1 = unwrap(timelines.versions.list(doc.id)).items[0]!;
    const foreign = await bus.dispatch(
      commands.restoreVersion,
      { projectId: other.project.id, timelineId: doc.id, versionId: v1.id },
      ui,
    );
    expect(!foreign.ok && foreign.error.code).toBe('core.not_found');
    const mixed = await bus.dispatch(
      commands.restoreVersion,
      {
        projectId: project.id,
        timelineId: doc.id,
        versionId: unwrap(timelines.versions.list(other.doc.id)).items[0]!.id,
      },
      ui,
    );
    expect(!mixed.ok && mixed.error.code).toBe('core.validation');
    expect(unwrap(await timelines.get(doc.id)).summary.revision).toBe(1);
    expect(setup.seen).toEqual([]);
  });
});
