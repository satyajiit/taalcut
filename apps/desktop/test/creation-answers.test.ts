// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CREATION_COMMANDS as C, newId, unwrap } from '@taalcut/core';
import { expect, it } from 'vitest';
import { checkpoint, creationWorld, draftProject, UI } from './helpers/creation';

it('requires a refreshed answered script and retains verified logos through script-only edits', async () => {
  const world = creationWorld();
  let project = await draftProject(world);
  project = await checkpoint(world, project, {
    draft: {
      ...project.draft!,
      questions: [{ id: 'date', prompt: 'Launch date?', required: true, answer: null }],
    },
    tasks: [
      {
        id: newId<'CreationTask'>(),
        key: 'brand:logos',
        role: 'researcher',
        inputRevision: 1,
        costMicros: 0,
        tokens: 0,
        parentId: null,
        status: 'completed',
        progress: 1,
        message: 'Brand',
        artifact: '[{"name":"Example","svg":"<svg/>","sourceUrl":"https://svgl.app"}]',
      },
    ],
  });
  const originalLogo = project.tasks[0]!.artifact;
  unwrap(
    await world.bus.dispatch(
      C.answer,
      {
        projectId: project.projectId,
        revision: project.revision,
        draftRevision: project.draft!.revision,
        answers: [{ id: 'date', answer: 'November 11' }],
      },
      UI,
    ),
  );
  project = unwrap(await world.store.get(project.projectId));
  expect(project.draft).toMatchObject({ answersPending: true, visualPreviewAssetId: null });
  expect(project.tasks[0]).toMatchObject({ artifact: originalLogo, inputRevision: project.draft!.revision });
  expect(
    (
      await world.bus.dispatch(
        C.approve,
        {
          projectId: project.projectId,
          revision: project.revision,
          draftRevision: project.draft!.revision,
        },
        UI,
      )
    ).ok,
  ).toBe(false);
  unwrap(
    await world.bus.dispatch(
      C.updateDraft,
      {
        projectId: project.projectId,
        revision: project.revision,
        draftRevision: project.draft!.revision,
        draft: { ...project.draft!, title: 'My edited title' },
      },
      UI,
    ),
  );
  project = unwrap(await world.store.get(project.projectId));
  expect(project.tasks[0]).toMatchObject({ artifact: originalLogo, inputRevision: project.draft!.revision });
  unwrap(
    await world.bus.dispatch(
      C.updateBrief,
      {
        projectId: project.projectId,
        revision: project.revision,
        brief: { ...project.brief, title: 'New brand' },
      },
      UI,
    ),
  );
  expect(unwrap(await world.store.get(project.projectId)).tasks).toEqual([]);
});
