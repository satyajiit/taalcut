// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  err,
  editItemsOf,
  RationalTime,
  ok,
  parseId,
  type AsyncResult,
  type EditingOwnership,
  type ProjectId,
  type RunId,
} from '@taalcut/core';
import type { AgentDeps, StartRequest } from '../agent-types';
import type { EventLogStore } from '../ports';

/** Acquire before resolving the prompt so its targets and before-snapshot cannot move underneath it. */
export async function acquireEditor(
  deps: AgentDeps,
  request: StartRequest,
  runId: RunId,
): AsyncResult<ProjectId | null> {
  if (!deps.editing) return ok(null);
  const doc = request.editorContext
    ? await deps.phase3?.editor?.timeline(request.editorContext.timelineId)
    : undefined;
  if (doc && !doc.ok) return doc;
  const projectId = doc?.value.projectId ?? request.comments?.projectId ?? request.projectId;
  if (!projectId) return ok(null);
  const targets =
    doc?.ok && request.editorContext
      ? editItemsOf(doc.value)
          .filter((item) =>
            request.editorContext!.selection.some((target) => {
              if (target.timelineId !== doc.value.id) return false;
              if (target.kind === 'item') return target.itemId === item.target.itemId;
              if (target.kind === 'timeline') return true;
              const start = RationalTime.toFrames(target.range.start, doc.value.canvas.rate);
              const end = start + RationalTime.toFrames(target.range.duration, doc.value.canvas.rate);
              return item.start < end && item.end > start;
            }),
          )
          .map((item) => item.target.itemId)
      : [];
  const acquired = await deps.editing.acquire(projectId as ProjectId, runId, request.editorContext, targets);
  if (!acquired.ok) {
    await deps.editing.release(runId);
    return acquired;
  }
  if (doc && request.editorContext) {
    const current = await deps.phase3!.editor!.timeline(doc.value.id);
    if (!current.ok || current.value.revision !== request.editorContext.revision) {
      await deps.editing.release(runId);
      return current.ok ? err(ConflictError({ entity: 'timeline', id: doc.value.id })) : current;
    }
  }
  return ok(projectId as ProjectId);
}

/** Restores ownership from durable open run logs before the agent process starts serving editing work. */
export async function restoreEditorOwnership(
  log: EventLogStore,
  editing: EditingOwnership,
): AsyncResult<void> {
  const open = await log.openRuns();
  if (!open.ok) return open;
  for (const runId of open.value) {
    const events = await log.read(runId);
    if (!events.ok) return events;
    const started = events.value.find((event) => event.type === 'run.started');
    if (started?.type !== 'run.started' || !started.payload.editingProjectId) continue;
    const project = parseId<'Project'>(started.payload.editingProjectId);
    if (!project.ok) return project;
    const restored = editing.restore(
      project.value,
      runId,
      started.payload.editingContext,
      started.payload.editingTargets,
    );
    if (!restored.ok) return restored;
  }
  return ok(undefined);
}
