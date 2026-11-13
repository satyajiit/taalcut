// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { idSchema, type ProjectId } from '../basics/ids';
import { eventIterator, ipc } from '../ipc/contract';
import { editorActivitySchema, type EditorActivity, type EditingOwnership } from './editing-ownership';

const project = z.object({ projectId: idSchema<'Project'>() });
export const editorActivityContract = {
  editing: ipc.input(project).output(editorActivitySchema),
  watchEditing: ipc.input(project).output(eventIterator(editorActivitySchema)),
};

export async function* watchEditorActivity(
  editing: EditingOwnership,
  projectId: ProjectId,
  signal: AbortSignal,
): AsyncGenerator<EditorActivity> {
  if (signal.aborted) return;
  let pending: EditorActivity | null = null;
  let wake: (() => void) | undefined;
  const off = editing.subscribe((activity) => {
    if (activity.projectId !== projectId) return;
    pending = activity;
    wake?.();
  });
  const aborted = () => wake?.();
  signal.addEventListener('abort', aborted, { once: true });
  try {
    yield editing.snapshot(projectId);
    while (!signal.aborted) {
      if (!pending)
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      if (signal.aborted) return;
      if (pending) {
        const activity = pending;
        pending = null;
        yield activity;
      }
    }
  } finally {
    off();
    signal.removeEventListener('abort', aborted);
  }
}
