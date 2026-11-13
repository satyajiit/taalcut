// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  creationProjectSchema,
  err,
  NotFoundError,
  ok,
  ValidationError,
  type CreationProject,
  type CreationStore,
  type ProjectId,
  type Result,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { stagedWriter } from '../stores/staged-write';

/** Revision checks run again inside the command transaction, including updates from child tasks. */
export function createCreationStore(
  db: LibraryDatabase,
  options: { readonly commands?: CommandStager } = {},
): CreationStore {
  const write = stagedWriter(db, options.commands, 'creationProject');
  const revision = (projectId: ProjectId): number => {
    const row = db.driver
      .prepare('SELECT revision FROM creation_projects WHERE project_id = ?')
      .get(projectId);
    return typeof row?.['revision'] === 'number' ? row['revision'] : 0;
  };
  const parse = (state: unknown): Result<CreationProject> => {
    try {
      const value = creationProjectSchema.safeParse(typeof state === 'string' ? JSON.parse(state) : state);
      return value.success
        ? ok(value.data)
        : err(
            ValidationError({ field: 'creationProject' }, { detail: 'Stored creation project is invalid' }),
          );
    } catch {
      return err(
        ValidationError({ field: 'creationProject' }, { detail: 'Stored creation project is unreadable' }),
      );
    }
  };
  return {
    async get(projectId) {
      const row = db.driver
        .prepare('SELECT state FROM creation_projects WHERE project_id = ?')
        .get(projectId);
      return row ? parse(row['state']) : err(NotFoundError({ entity: 'creationProject', id: projectId }));
    },
    async list() {
      const rows = db.driver
        .prepare(
          'SELECT c.state FROM creation_projects c JOIN projects p ON p.id = c.project_id WHERE p.archived_at IS NULL ORDER BY c.updated_at DESC LIMIT 200',
        )
        .all();
      const projects: CreationProject[] = [];
      for (const row of rows) {
        const parsed = parse(row['state']);
        if (!parsed.ok) return parsed;
        projects.push(parsed.value);
      }
      return ok(projects);
    },
    async save(project, expectedRevision, context) {
      const parsed = creationProjectSchema.safeParse(project);
      if (!parsed.success || project.revision !== expectedRevision + 1)
        return err(
          ValidationError({ field: 'revision' }, { detail: 'A creation write must advance one revision' }),
        );
      const check = (): Result<void> =>
        revision(project.projectId) === expectedRevision
          ? ok(undefined)
          : err(ConflictError({ entity: 'creationProject', id: project.projectId }));
      return write(context, check, () => {
        db.driver
          .prepare(
            `INSERT INTO creation_projects(project_id, revision, state, updated_at)
          VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET
          revision=excluded.revision, state=excluded.state, updated_at=excluded.updated_at`,
          )
          .run(project.projectId, project.revision, JSON.stringify(parsed.data), project.updatedAt);
      });
    },
  };
}
