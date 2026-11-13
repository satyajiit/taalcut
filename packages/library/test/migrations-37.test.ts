// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 37 (REF1-KEEP): `template_media`. The checks hold a row to a plain file name, a positive size and
 * length, a sha256, a known source; the row goes with its template. Down removes the table; up again starts empty.
 */
import { unwrap, type TemplateId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createTemplateStore } from '../src/index';
import { openTestDb, tempDir } from './helpers';
import { template } from './stores/documents';

const tables = (db: ReturnType<typeof openTestDb>) =>
  db.driver
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'template_media'`)
    .all()
    .map((row) => row.name);

describe('migration 37: a template’s kept reel', () => {
  it('creates the table, holds rows to their shape, goes with the template, and goes down and up again', async () => {
    const db = openTestDb({ targetVersion: 36 });
    expect(tables(db)).toEqual([]);
    unwrap(db.migrateTo(37));
    expect(tables(db)).toEqual(['template_media']);

    const doc = template();
    const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
    unwrap(await store.create(doc, { name: 'Goa', projectId: null, listed: true }));
    const insert =
      (fields: Partial<Record<string, unknown>> = {}, id: string = doc.id) =>
      () => {
        const row = {
          file: 'reference.mp4',
          bytes: 10,
          duration_ms: 1500,
          sha256: 'a'.repeat(64),
          has_audio: 1,
          source: 'anonymous',
          ...fields,
        };
        db.driver
          .prepare(
            `INSERT INTO template_media (template_id, file, bytes, duration_ms, sha256, has_audio, source, kept_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .run(id, row.file, row.bytes, row.duration_ms, row.sha256, row.has_audio, row.source);
      };
    for (const bad of [
      { file: '../reference.mp4' },
      { file: '.reference.mp4' },
      { file: 'Reference.mp4' },
      { bytes: 0 },
      { duration_ms: 0 },
      { sha256: 'A'.repeat(64) },
      { has_audio: 2 },
      { source: 'cookies' },
    ])
      expect(insert(bad), JSON.stringify(bad)).toThrow(/CHECK/);
    expect(insert({}, 'no-such-template')).toThrow(/FOREIGN KEY/);
    insert()();
    expect(insert()).toThrow(/UNIQUE|PRIMARY KEY/);

    unwrap(await store.remove(doc.id as TemplateId));
    expect(db.driver.prepare('SELECT count(*) AS n FROM template_media').get()).toEqual({ n: 0 });

    unwrap(db.migrateTo(36));
    expect(tables(db)).toEqual([]);
    unwrap(db.migrateTo(37));
    expect(db.driver.prepare('SELECT count(*) AS n FROM template_media').get()).toEqual({ n: 0 });
  });
});
