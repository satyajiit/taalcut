// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  newId,
  ok,
  type AsyncResult,
  type CreationProject,
  type CreationStore,
  type CreationTask,
  type ProjectId,
} from '@taalcut/core';
import { CreationInputsChanged } from './errors';

export function creationState(store: CreationStore, now: () => number) {
  const pending = new Map<ProjectId, Promise<void>>();
  async function write(
    projectId: ProjectId,
    change: (project: CreationProject) => CreationProject,
  ): AsyncResult<CreationProject> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const before = await store.get(projectId);
      if (!before.ok) return before;
      const next = { ...change(before.value), revision: before.value.revision + 1, updatedAt: now() };
      const saved = await store.save(next, before.value.revision);
      if (saved.ok) return ok(next);
      if (saved.error.code !== 'core.conflict') return saved;
    }
    return err(CreationInputsChanged());
  }

  function update(
    projectId: ProjectId,
    change: (project: CreationProject) => CreationProject,
  ): AsyncResult<CreationProject> {
    const result = (pending.get(projectId) ?? Promise.resolve()).then(() => write(projectId, change));
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    pending.set(projectId, tail);
    void tail.then(() => {
      if (pending.get(projectId) === tail) pending.delete(projectId);
    });
    return result;
  }

  async function task(
    projectId: ProjectId,
    key: string,
    role: CreationTask['role'],
    inputRevision: number,
  ): AsyncResult<CreationTask> {
    const id = newId<'CreationTask'>();
    const saved = await update(projectId, (project) => {
      if (project.tasks.some((t) => t.key === key && t.inputRevision === inputRevision)) return project;
      return {
        ...project,
        tasks: [
          ...project.tasks,
          {
            id,
            key,
            role,
            inputRevision,
            costMicros: 0,
            tokens: 0,
            parentId:
              role === 'director' ? null : (project.tasks.find((t) => t.role === 'director')?.id ?? null),
            status: 'queued',
            progress: 0,
            message: key,
            artifact: null,
          },
        ],
      };
    });
    return saved.ok
      ? ok(saved.value.tasks.find((t) => t.key === key && t.inputRevision === inputRevision)!)
      : saved;
  }

  function patch(projectId: ProjectId, taskId: CreationTask['id'], changes: Partial<CreationTask>) {
    return update(projectId, (project) => ({
      ...project,
      tasks: project.tasks.map((t) => (t.id === taskId ? { ...t, ...changes } : t)),
    }));
  }
  return { update, task, patch };
}
export type CreationState = ReturnType<typeof creationState>;
