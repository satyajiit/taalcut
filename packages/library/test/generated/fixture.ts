// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A sink over a temp originals root, and the rows the sink and the purge tests read. */
import { join } from 'node:path';
import { newId, type AssetId, type GeneratedFile, type ProjectId } from '@taalcut/core';
import { createGeneratedAssetSink, type LibraryDatabase } from '../../src/index';
import { fakeClock, openTestDb, tempDir } from '../helpers';

export function image(text: string, projectId: ProjectId | null = null): GeneratedFile {
  return {
    bytes: new TextEncoder().encode(text),
    mediaType: 'image/png',
    fileName: `image-call_01-${text.length}.png`,
    projectId,
    provenance: {
      kind: 'generated',
      generation: 'image',
      provider: 'openai',
      model: 'gpt-image-2',
      access: 'api-key',
      quality: null,
      promptSha256: 'b'.repeat(64),
      voiceId: null,
      providerRef: null,
      c2pa: 'present',
      costUsd: 0.04,
      runId: null,
      createdAt: 1,
    },
  };
}

export function setup() {
  const clock = fakeClock();
  const db = openTestDb({ clock: clock.now });
  const root = join(tempDir(), 'Originals');
  const events: unknown[] = [];
  const sink = createGeneratedAssetSink(db, {
    originalsRoot: () => root,
    events: { emit: (_name, payload) => events.push(payload) },
  });
  return { db, clock, root, sink, events };
}

export function row(db: LibraryDatabase, sql: string, ...params: string[]) {
  return db.driver.prepare(sql).get(...params);
}

export function project(db: LibraryDatabase): ProjectId {
  const id = newId<'Project'>();
  db.driver
    .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)')
    .run(id, 'P');
  return id;
}

/** A timeline whose document is `document`; with `clipOf`, its refs row too. */
export function timeline(db: LibraryDatabase, document: object, clipOf?: AssetId): string {
  const id = newId<'Timeline'>();
  db.driver
    .prepare(
      `INSERT INTO timelines (id, project_id, name, schema_version, document, revision, clip_count,
         duration_value, duration_rate_num, duration_rate_den, created_at, updated_at)
       VALUES (?, ?, 'T', 2, ?, 1, 1, 0, 25, 1, 1, 1)`,
    )
    .run(id, project(db), JSON.stringify(document));
  if (clipOf) {
    db.driver
      .prepare('INSERT INTO timeline_asset_refs (timeline_id, asset_id) VALUES (?, ?)')
      .run(id, clipOf);
  }
  return id;
}
