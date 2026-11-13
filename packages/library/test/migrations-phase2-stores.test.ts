// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migrations 14–17 (template store, projects and versions, renders, the
 * telemetry outbox) up and down with data: existing projects keep their rows
 * and get no cap, the new tables come and go, and the foreign keys hold.
 */
import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { type LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';

const sql = (db: LibraryDatabase, text: string, ...params: (string | number | null)[]) =>
  db.driver.prepare(text).run(...params);
const get = (db: LibraryDatabase, text: string, ...params: (string | number)[]) =>
  db.driver.prepare(text).get(...params);
const tables = (db: LibraryDatabase) =>
  db.driver
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => String(r.name));
const columns = (db: LibraryDatabase, table: string) =>
  db.driver
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => String(c.name));

describe('migrations 14–17 (stores)', () => {
  it('add the store tables and project columns, and take them away again', () => {
    const db = openTestDb({ targetVersion: 13 });
    const projectId = newId<'Project'>();
    sql(db, `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, 'Goa', 1, 2)`, projectId);
    const before = columns(db, 'projects');

    unwrap(db.migrateTo(17));
    expect(get(db, 'SELECT * FROM projects')).toMatchObject({
      id: projectId,
      name: 'Goa',
      archived_at: null,
      last_opened_at: null,
      budget_cap_micros: null,
      budget_cap_currency: null,
    });
    for (const table of ['templates', 'template_versions', 'template_assets', 'template_fts', 'timelines'])
      expect(tables(db)).toContain(table);
    for (const table of ['timeline_versions', 'timeline_asset_refs', 'renders', 'telemetry_outbox'])
      expect(tables(db)).toContain(table);

    unwrap(db.migrateTo(13));
    expect(columns(db, 'projects')).toEqual(before);
    expect(get(db, 'SELECT name FROM projects WHERE id = ?', projectId)).toEqual({ name: 'Goa' });
    for (const table of ['templates', 'timelines', 'renders', 'telemetry_outbox', 'template_fts'])
      expect(tables(db)).not.toContain(table);
    unwrap(db.migrateTo(17));
  });

  it('cascades from projects and timelines, and keeps an asset a timeline uses', () => {
    const db = openTestDb();
    const projectId = newId<'Project'>();
    const timelineId = newId<'Timeline'>();
    const assetId = newId<'Asset'>();
    sql(db, `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, 'Goa', 1, 1)`, projectId);
    sql(
      db,
      `INSERT INTO assets (id, kind, size_bytes, original_filename, availability, created_at)
       VALUES (?, 'video', 1, 'a.mov', 'missing', 1)`,
      assetId,
    );
    sql(
      db,
      `INSERT INTO timelines (id, project_id, name, schema_version, document, revision, clip_count,
         duration_value, duration_rate_num, duration_rate_den, created_at, updated_at)
       VALUES (?, ?, 'Cut', 1, '{}', 1, 0, 0, 30, 1, 1, 1)`,
      timelineId,
      projectId,
    );
    sql(db, 'INSERT INTO timeline_asset_refs (timeline_id, asset_id) VALUES (?, ?)', timelineId, assetId);
    sql(
      db,
      `INSERT INTO timeline_versions (id, timeline_id, number, kind, schema_version, document, revision,
         document_hash, created_at) VALUES (?, ?, 1, 'auto', 1, '{}', 1, ?, 1)`,
      newId<'TimelineVersion'>(),
      timelineId,
      'a'.repeat(64),
    );
    expect(() => sql(db, 'DELETE FROM assets WHERE id = ?', assetId)).toThrow(); // RESTRICT
    expect(() =>
      sql(
        db,
        `INSERT INTO timeline_versions (id, timeline_id, number, kind, schema_version, document,
        revision, document_hash, created_at) VALUES ('x', ?, 1, 'auto', 1, '{}', 1, ?, 1)`,
        timelineId,
        'b'.repeat(64),
      ),
    ).toThrow(); // one number per timeline
    expect(() => sql(db, `UPDATE timelines SET template_id = 't' WHERE id = ?`, timelineId)).toThrow(); // a template ref needs its version
    sql(db, 'DELETE FROM projects WHERE id = ?', projectId);
    expect(get(db, 'SELECT count(*) AS n FROM timeline_versions')).toEqual({ n: 0 });
    expect(get(db, 'SELECT count(*) AS n FROM timeline_asset_refs')).toEqual({ n: 0 });
    sql(db, 'DELETE FROM assets WHERE id = ?', assetId); // free now
  });

  it('refuses rows outside their checks', () => {
    const db = openTestDb();
    const bad = [
      `INSERT INTO telemetry_outbox (envelope, created_at) VALUES ('not json', 1)`,
      `INSERT INTO template_assets (sha256, media_type, bytes, created_at) VALUES ('${'a'.repeat(64)}', 'image/png', 1, 1)`,
      `INSERT INTO templates (id, name, listed, head_version, created_at, updated_at) VALUES ('t', '', 1, 1, 1, 1)`,
    ];
    for (const statement of bad) expect(() => sql(db, statement)).toThrow();
  });
});
