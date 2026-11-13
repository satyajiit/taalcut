// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, type AssetId, type AsyncResult, type CreationDraft, type CreationProject } from '@taalcut/core';
import { CreationReviewFailed } from './errors';
import type { CreationDirectorDeps } from './ports';
import { creationRepairNotes } from './repair';
import { makeCreationScene } from './scenes';
import type { CreationTasks } from './tasks';

export async function makeCreationLook(
  deps: CreationDirectorDeps,
  tasks: CreationTasks,
  project: CreationProject,
  draft: CreationDraft,
  signal: AbortSignal,
): AsyncResult<AssetId> {
  let notes: readonly string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const scene = await makeCreationScene(
      tasks,
      project,
      draft,
      draft.beats[0]!,
      project.brief.formats[0]!,
      true,
      notes,
      attempt,
    );
    const result = scene.ok
      ? await deps.preview(scene.value, project.brief, signal, project.projectId)
      : scene;
    if (result.ok) return result;
    const repair = creationRepairNotes(result.error);
    if (!repair) return result;
    notes = repair;
  }
  return err(CreationReviewFailed(undefined, { detail: notes.join('\n') }));
}
