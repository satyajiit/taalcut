// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 31 (LRN1-STY): `style_profiles` and `project_styles`. The checks hold a row to a digest of 64 and valid
 * JSON; deleting a folder or a Saved collection deletes its set's profile (derived data), deleting a project its
 * style. Down removes both tables and the triggers; up again starts empty.
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';
import { seed } from './stores/documents';

const profile =
  (db: LibraryDatabase, key: string, digest = 'd'.repeat(64), json = '{}') =>
  () =>
    db.driver
      .prepare(
        `INSERT INTO style_profiles (source_key, digest, profile, summary, built_at) VALUES (?, ?, NULL, ?, 1)`,
      )
      .run(key, digest, json);

const objects = (db: LibraryDatabase) =>
  db.driver
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE (name LIKE 'style_profile%' OR name LIKE 'project_style%') AND type IN ('table', 'trigger', 'index')
         AND name NOT LIKE 'sqlite_autoindex%'
       ORDER BY name`,
    )
    .all()
    .map((row) => row.name);

const keys = (db: LibraryDatabase) =>
  db.driver
    .prepare('SELECT source_key FROM style_profiles ORDER BY source_key')
    .all()
    .map((row) => row.source_key);

describe('migration 31: style profiles', () => {
  it('creates the tables and triggers, holds rows to their shape, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 30 });
    expect(objects(db)).toEqual([]);
    unwrap(db.migrateTo(31));
    expect(objects(db)).toEqual([
      'project_styles',
      'project_styles_source_idx',
      'style_profiles',
      'style_profiles_on_collection_delete',
      'style_profiles_on_folder_delete',
    ]);

    profile(db, 'my-exports')();
    expect(profile(db, 'tag:short', 'd'.repeat(63))).toThrow(/CHECK/);
    expect(profile(db, 'tag:json', 'd'.repeat(64), 'not json')).toThrow(/CHECK/);
    expect(profile(db, '')).toThrow(/CHECK/);
    expect(profile(db, 'my-exports')).toThrow(/UNIQUE|PRIMARY KEY/);

    unwrap(db.migrateTo(30));
    expect(objects(db)).toEqual([]);
    unwrap(db.migrateTo(31));
    expect(db.driver.prepare('SELECT count(*) AS n FROM style_profiles').get()).toEqual({ n: 0 });
  });

  it("drops a deleted folder's or collection's profile, and a deleted project's style", () => {
    const db = openTestDb();
    const sql = (text: string, ...values: (string | number)[]) => db.driver.prepare(text).run(...values);
    sql(`INSERT INTO template_folders (id, name, name_key, created_at) VALUES ('fld', 'Hooks', 'hooks', 1)`);
    sql(`INSERT INTO instagram_collections (id, name, updated_at) VALUES ('col_a', 'Travel', 1)`);
    for (const key of ['folder:fld', 'instagram-collection:col_a', 'tag:travel', 'my-exports'])
      profile(db, key)();

    sql(`DELETE FROM template_folders WHERE id = 'fld'`);
    expect(keys(db)).toEqual(['instagram-collection:col_a', 'my-exports', 'tag:travel']);
    sql(`DELETE FROM instagram_collections WHERE id = 'col_a'`);
    expect(keys(db)).toEqual(['my-exports', 'tag:travel']);

    const { project, repos } = seed(db);
    sql(
      `INSERT INTO project_styles (project_id, source_key, updated_at) VALUES (?, 'tag:travel', 1)`,
      project.id,
    );
    expect(() =>
      sql(`INSERT INTO project_styles (project_id, source_key, updated_at) VALUES ('nope', 'tag:travel', 1)`),
    ).toThrow(/FOREIGN KEY/);
    unwrap(repos.projects.remove(project.id));
    expect(db.driver.prepare('SELECT count(*) AS n FROM project_styles').get()).toEqual({ n: 0 });
    expect(keys(db)).toEqual(['my-exports', 'tag:travel']);
  });
});
