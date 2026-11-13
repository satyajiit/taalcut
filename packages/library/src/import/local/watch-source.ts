// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { basename } from 'node:path';
import { ok, type AsyncResult, type SourceId } from '@taalcut/core';
import { createSourceRepository } from '../../repositories/sources';
import type { LocalImportAdapterDeps } from './types';

/** Watching an empty folder is useful; source setup does not depend on finding a first clip. */
export async function configureImportWatch(
  deps: LocalImportAdapterDeps,
  root: string,
  recursive: boolean,
): AsyncResult<SourceId> {
  const sources = createSourceRepository(deps.db);
  let source = sources.list({ kinds: ['watched_folder'] }).find((value) => value.rootPath === root);
  if (!source) {
    const volume = await deps.volumes.identify(root);
    const added = sources.add({
      kind: 'watched_folder',
      displayName: basename(root),
      rootPath: root,
      watch: true,
      volumeUuid: volume?.uuid ?? null,
      volumeName: volume?.name ?? null,
    });
    if (!added.ok) return added;
    source = added.value;
  } else {
    const updated = sources.update(source.id, { watch: true });
    if (!updated.ok) return updated;
  }
  deps.db.driver
    .prepare(
      'INSERT INTO import_source_scopes (source_id, recursive) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET recursive = excluded.recursive',
    )
    .run(source.id, recursive ? 1 : 0);
  deps.events?.emit('library.changed', {
    projectId: null,
    entity: 'source',
    change: 'updated',
    ids: [source.id],
  });
  return ok(source.id);
}
