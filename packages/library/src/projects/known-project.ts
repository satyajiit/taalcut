// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ProjectId } from '@taalcut/core';
import { eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { projects } from '../schema/chat';

/** A project that is still there, or null (the FK would refuse a deleted one). */
export function knownProject(db: LibraryDatabase, projectId: ProjectId | null): ProjectId | null {
  if (projectId === null) return null;
  const found = db.orm.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get();
  return found ? projectId : null;
}
