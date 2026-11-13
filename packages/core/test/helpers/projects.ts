// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The demo command for the command-bus tests: `project.rename` over an
 * in-memory project repository, plus a fake agent tool that wraps it the way
 * packages/tools will. The real command lives with the projects repository in
 * packages/library.
 */
import { z } from 'zod';
import {
  defineCommand,
  idSchema,
  newId,
  NotFoundError,
  err,
  ok,
  type AsyncResult,
  type CommandBus,
  type ProjectId,
  type RunId,
} from '@taalcut/core';

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
}

export interface ProjectRepository {
  get(id: ProjectId): AsyncResult<Project>;
  rename(id: ProjectId, name: string): AsyncResult<void>;
}

export function createMemoryProjects(...names: string[]) {
  const projects = new Map<ProjectId, Project>();
  for (const name of names) {
    const id = newId<'Project'>();
    projects.set(id, { id, name });
  }
  const repository: ProjectRepository = {
    async get(id) {
      const project = projects.get(id);
      return project ? ok(project) : err(NotFoundError({ entity: 'project', id }));
    },
    async rename(id, name) {
      const project = projects.get(id);
      if (!project) return err(NotFoundError({ entity: 'project', id }));
      projects.set(id, { ...project, name });
      return ok(undefined);
    },
  };
  return {
    repository,
    ids: [...projects.keys()],
    nameOf: (id: ProjectId) => projects.get(id)?.name,
  };
}

export const renameProjectPayload = z.object({
  projectId: idSchema<'Project'>(),
  name: z.string().trim().min(1).max(200),
});

/** Written as a plain factory: the composition root passes the repository. */
export function createProjectRenameCommand({ projects }: { projects: ProjectRepository }) {
  return defineCommand({
    name: 'project.rename',
    payload: renameProjectPayload,
    sideEffect: 'write',
    handle: async ({ projectId, name }) => {
      const before = await projects.get(projectId);
      if (!before.ok) return before;
      const renamed = await projects.rename(projectId, name);
      if (!renamed.ok) return renamed;
      return ok({
        result: { projectId, name },
        inverse: { name: 'project.rename', payload: { projectId, name: before.value.name } },
      });
    },
  });
}

/** What an agent tool looks like: untyped model input, dispatched by name with the agent's origin. */
export function createRenameProjectTool(bus: CommandBus) {
  return {
    name: 'project.rename',
    sideEffect: 'write' as const,
    run: (input: unknown, runId: RunId) =>
      bus.dispatch('project.rename', input, { source: 'agent', actor: `agent:${runId}` }),
  };
}
