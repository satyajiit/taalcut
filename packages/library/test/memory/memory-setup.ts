// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Memory items and a library with a project and a template to scope them to (LRN1-MEM tests). */
import { join } from 'node:path';
import { newId, unwrap, type MemoryItem, type MemoryScope } from '@taalcut/core';
import { createTemplateStore, type LibraryDatabase } from '../../src/index';
import { tempDir } from '../helpers';
import { seed, template } from '../stores/documents';

let clock = Date.UTC(2026, 9, 26);

export function memoryItem(options: Partial<MemoryItem> & { readonly scope?: MemoryScope } = {}): MemoryItem {
  clock += 1000;
  return {
    id: newId<'MemoryItem'>(),
    scope: { kind: 'user' },
    text: 'Never use whip transitions.',
    source: 'user',
    data: null,
    conversationId: null,
    revision: 1,
    createdAt: clock,
    updatedAt: clock,
    ...options,
  };
}

/** A project ("Goa trip") and a template ("Sunset montage") in the database. */
export async function scopes(db: LibraryDatabase) {
  const { project } = seed(db);
  const templates = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
  const made = unwrap(
    await templates.create(template(), { name: 'Sunset montage', projectId: null, listed: true }),
  );
  return {
    project: { kind: 'project', projectId: project.id } as const satisfies MemoryScope,
    template: { kind: 'template', templateId: made.id } as const satisfies MemoryScope,
    projectId: project.id,
    templateId: made.id,
    templates,
  };
}
