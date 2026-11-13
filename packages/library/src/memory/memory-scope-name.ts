// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A memory scope's name (LRN1-MEM): its project's or template's, null for the user scope. The store checks a scope
 * with it before a write, and memory.remember's card says where an item would apply with it.
 */
import { err, NotFoundError, ok, type MemoryScope, type Result } from '@taalcut/core';
import { eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { projects } from '../schema/chat';
import { templates } from '../schema/templates';

/** core.not_found (entity 'project' or 'template') when the scope's doesn't exist. */
export function memoryScopeName(db: LibraryDatabase, scope: MemoryScope): Result<string | null> {
  const { orm } = db;
  if (scope.kind === 'user') return ok(null);
  if (scope.kind === 'project') {
    const found = orm
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, scope.projectId))
      .get();
    return found ? ok(found.name) : err(NotFoundError({ entity: 'project', id: scope.projectId }));
  }
  const found = orm
    .select({ name: templates.name })
    .from(templates)
    .where(eq(templates.id, scope.templateId))
    .get();
  return found ? ok(found.name) : err(NotFoundError({ entity: 'template', id: scope.templateId }));
}
