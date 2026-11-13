// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, ok, type AsyncResult, type EditorContext } from '@taalcut/core';
import type { Backend } from '../backend/backend';
import type { EditorDrafts } from '../backend/editor-drafts';

export async function prepareEditorSend(
  backend: Backend,
  drafts: EditorDrafts,
  context: EditorContext | undefined,
): AsyncResult<EditorContext | undefined> {
  if (!context) return ok(undefined);
  const before = await callRpc(backend.timelines.get({ timelineId: context.timelineId }));
  if (!before.ok) return before;
  const saved = await drafts.flush(context.timelineId, before.value.projectId);
  if (!saved.ok) return saved;
  const latest = await callRpc(backend.timelines.get({ timelineId: context.timelineId }));
  return latest.ok ? ok({ ...context, revision: latest.value.revision }) : latest;
}
