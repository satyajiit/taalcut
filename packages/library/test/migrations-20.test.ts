// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 20 (template library and Styles, P3-V14, P3-V10) with Phase 2 data: templates keep every row and gain
 * empty metadata, each version's head facts are read from its stored document, the search rows survive the FTS
 * rebuild, a timeline's Style is read from its document, and down puts the Phase 2 tables back with their rows.
 */
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTemplateStore, createTimelineStore, type LibraryDatabase } from '../src/index';
import { openTestDb, tempDir } from './helpers';
import { seed, template, timeline } from './stores/documents';
import { formatTemplate } from './stores/style-documents';

const all = (db: LibraryDatabase, text: string, ...params: string[]) =>
  db.driver.prepare(text).all(...params);
const columns = (db: LibraryDatabase, table: string) =>
  all(db, `PRAGMA table_xinfo(${table})`).map((column) => String(column.name));

describe('migration 20: template library and Styles', () => {
  it('backfills Phase 2 templates and timelines, and down restores them', async () => {
    const db = openTestDb({ targetVersion: 20 });
    const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
    // A timeline written by today's store, taken back to version 19 (Phase 2's columns) and given a Style.
    const { project, assets } = seed(db);
    const named = timeline(project.id, assets);
    unwrap(await createTimelineStore(db).create(named));
    unwrap(db.migrateTo(19));
    const styleId = 'S'.repeat(26);
    db.driver
      .prepare(`UPDATE timelines SET document = json_set(document, '$.styleId', ?) WHERE id = ?`)
      .run(styleId, named.id);
    const reel = template({ overlay: 'Monsoon in Goa' });
    const approved = { ...reel, slots: reel.slots.map((slot, i) => ({ ...slot, approved: i < 2 })) };
    const plan = formatTemplate({ formatId: 'tutorial', language: 'es' });
    // Version 19's store writes the Phase 2 columns only: insert as it did, through SQL.
    for (const [doc, name] of [
      [approved, 'Reel'],
      [plan, 'Plan'],
    ] as const) {
      db.driver
        .prepare(
          `INSERT INTO templates (id, name, project_id, listed, head_version, archived_at, created_at, updated_at)
           VALUES (?, ?, NULL, 1, 1, NULL, 1, 1)`,
        )
        .run(doc.id, name);
      db.driver
        .prepare(
          `INSERT INTO template_versions (template_id, version, parent_version, schema_version, document, origin,
             duration_value, duration_rate_num, duration_rate_den, slot_count, created_at)
           VALUES (?, 1, NULL, 1, ?, ?, 90, 30, 1, 3, 1)`,
        )
        .run(doc.id, JSON.stringify(doc), doc.origin.kind);
      db.driver
        .prepare('INSERT INTO template_fts (template_id, name, intents, overlays) VALUES (?, ?, ?, ?)')
        .run(doc.id, name, 'wide beach', doc.text[0]?.text ?? '');
    }

    unwrap(db.migrateTo(20));
    const versions = all(
      db,
      'SELECT template_id, format_id, language, style_id, approved_slots, slot_strip FROM template_versions',
    );
    expect(versions).toContainEqual({
      template_id: approved.id,
      format_id: null,
      language: 'en',
      style_id: null,
      approved_slots: 2,
      slot_strip: '[30,30,30]',
    });
    expect(versions).toContainEqual(
      expect.objectContaining({ template_id: plan.id, format_id: 'tutorial', language: 'es' }),
    );
    expect(all(db, 'SELECT tags, folder_id, favourite, trend_date, provenance FROM templates')).toEqual([
      { tags: '[]', folder_id: null, favourite: 0, trend_date: null, provenance: null },
      { tags: '[]', folder_id: null, favourite: 0, trend_date: null, provenance: null },
    ]);
    expect(all(db, 'SELECT style_id FROM timelines')).toEqual([{ style_id: styleId }]);
    // The store reads what later migrations add (24: name_key, 37: template_media); down to 19 below passes back
    // through them.
    unwrap(db.migrateTo(37));
    const found = unwrap(
      await store.list({ query: 'monsoon', includeUnlisted: true, includeArchived: true, limit: 5 }),
    );
    expect(found.items.map((item) => item.name)).toEqual(['Reel']);
    expect(unwrap(await store.get(plan.id)).summary).toMatchObject({ formatId: 'tutorial', language: 'es' });

    unwrap(await store.setMeta(approved.id, { tags: ['beach'], favourite: true }));
    unwrap(db.migrateTo(19));
    expect(columns(db, 'templates')).toEqual([
      'id',
      'name',
      'project_id',
      'listed',
      'head_version',
      'archived_at',
      'created_at',
      'updated_at',
    ]);
    expect(columns(db, 'template_versions')).not.toContain('style_id');
    expect(columns(db, 'timelines')).not.toContain('style_id');
    // FTS5 lists its hidden columns (the table's own name and rank) after the real ones.
    expect(columns(db, 'template_fts')).toEqual([
      'template_id',
      'name',
      'intents',
      'overlays',
      'template_fts',
      'rank',
    ]);
    expect(
      all(db, "SELECT name FROM sqlite_schema WHERE name IN ('styles', 'style_assets', 'template_folders')"),
    ).toEqual([]);
    expect(all(db, 'SELECT name FROM templates ORDER BY name').map((row) => row.name)).toEqual([
      'Plan',
      'Reel',
    ]);
    expect(all(db, 'SELECT count(*) AS n FROM template_versions')).toEqual([{ n: 2 }]);
    expect(all(db, "SELECT template_id FROM template_fts WHERE template_fts MATCH 'monsoon'")).toEqual([
      { template_id: approved.id },
    ]);
    unwrap(db.migrateTo(20));
    expect(all(db, 'SELECT favourite FROM templates WHERE id = ?', approved.id)).toEqual([{ favourite: 0 }]);
  });
});
