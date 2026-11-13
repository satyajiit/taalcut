// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CREATION_COMMANDS as C, PROJECT_COMMANDS, unwrap } from '@taalcut/core';
import { createProjectCommands, createProjectRepository, LibraryPortsToken } from '@taalcut/library';
import { expect, it } from 'vitest';
import { creationWorld, draftProject, UI, type CreationWorld } from './helpers/creation';

const projectName = (world: CreationWorld, id: Parameters<typeof world.store.get>[0]) =>
  unwrap(createProjectRepository(world.db).get(id)).name;

async function manualName(world: CreationWorld, projectId: Parameters<typeof world.store.get>[0]) {
  const commands = createProjectCommands({
    projects: createProjectRepository(world.db),
    timelines: world.timelines,
    commands: world.container.resolve(LibraryPortsToken).commands,
  });
  world.bus.register(commands.rename);
  unwrap(await world.bus.dispatch(PROJECT_COMMANDS.rename, { projectId, name: 'Custom project name' }, UI));
}

it('changes the brief and project name together, restoring the actual old name across restart undo/redo', async () => {
  const world = creationWorld();
  const before = await draftProject(world);
  const { projectId } = before;
  await manualName(world, projectId);
  unwrap(
    await world.bus.dispatch(
      C.updateBrief,
      {
        projectId,
        revision: before.revision,
        brief: { ...before.brief, title: 'Revised launch' },
      },
      UI,
    ),
  );
  expect(unwrap(await world.store.get(projectId)).brief.title).toBe('Revised launch');
  expect(projectName(world, projectId)).toBe('Revised launch');

  world.db.close();
  const reopened = creationWorld(world.userData);
  unwrap(await reopened.bus.undo(projectId, UI));
  expect(unwrap(await reopened.store.get(projectId)).brief.title).toBe('Launch');
  expect(projectName(reopened, projectId)).toBe('Custom project name');
  unwrap(await reopened.bus.redo(projectId, UI));
  expect(unwrap(await reopened.store.get(projectId)).brief.title).toBe('Revised launch');
  expect(projectName(reopened, projectId)).toBe('Revised launch');
});

it('preserves a manual project name when another brief field is edited or restored', async () => {
  const world = creationWorld();
  const before = await draftProject(world);
  const { projectId } = before;
  await manualName(world, projectId);
  unwrap(
    await world.bus.dispatch(
      C.updateBrief,
      {
        projectId,
        revision: before.revision,
        brief: { ...before.brief, audience: 'Founders' },
      },
      UI,
    ),
  );
  expect(projectName(world, projectId)).toBe('Custom project name');
  unwrap(await world.bus.undo(projectId, UI));
  expect(unwrap(await world.store.get(projectId)).brief.audience).toBe('');
  expect(projectName(world, projectId)).toBe('Custom project name');
  unwrap(await world.bus.redo(projectId, UI));
  expect(unwrap(await world.store.get(projectId)).brief.audience).toBe('Founders');
  expect(projectName(world, projectId)).toBe('Custom project name');
});

it('rolls back both names when the command audit cannot commit', async () => {
  const world = creationWorld();
  const before = await draftProject(world);
  world.db.driver.exec(
    "CREATE TRIGGER reject_creation_name BEFORE INSERT ON commands WHEN NEW.name='creation.updateBrief' BEGIN SELECT RAISE(ABORT, 'audit refused'); END",
  );
  const changed = await world.bus.dispatch(
    C.updateBrief,
    {
      projectId: before.projectId,
      revision: before.revision,
      brief: { ...before.brief, title: 'Never committed' },
    },
    UI,
  );
  expect(changed.ok).toBe(false);
  expect(unwrap(await world.store.get(before.projectId))).toEqual(before);
  expect(projectName(world, before.projectId)).toBe('Launch');
});
