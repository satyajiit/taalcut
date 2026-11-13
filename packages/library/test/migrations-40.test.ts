// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 40 (EDT1-CMT): `timeline_comments`. The checks hold a row to core's TimelineComment: JSON where JSON
 * goes, a body of 1..1000 characters, a one-line reply of 1..300, a known author and status. A comment goes with its
 * timeline. Down removes the table; up again starts empty.
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTimelineStore, type LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';
import { seed, timeline } from './stores/documents';

const insert = (
  db: LibraryDatabase,
  ids: { project: string; timeline: string },
  row: Record<string, string | null>,
) => {
  const values = {
    id: 'c1',
    anchor: '{"kind":"timeline"}',
    at: null,
    body: 'Make this half speed',
    author: 'user',
    status: 'open',
    reply: null,
    change_refs: null,
    ...row,
  };
  return () =>
    db.driver
      .prepare(
        `INSERT INTO timeline_comments (id, project_id, timeline_id, anchor, at, body, author, status, reply,
           change_refs, run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 1)`,
      )
      .run(
        values.id,
        ids.project,
        ids.timeline,
        values.anchor,
        values.at,
        values.body,
        values.author,
        values.status,
        values.reply,
        values.change_refs,
      );
};

const tables = (db: LibraryDatabase) =>
  db.driver
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'timeline_comments%' ORDER BY name")
    .all()
    .map((row) => row.name);

describe('migration 40: timeline comments', () => {
  it('holds rows to the comment shape, goes with the timeline, and goes down and up again', async () => {
    const db = openTestDb({ targetVersion: 40 });
    expect(tables(db)).toEqual([
      'timeline_comments',
      'timeline_comments_project_idx',
      'timeline_comments_timeline_idx',
    ]);
    const { project, assets } = seed(db);
    const document = timeline(project.id, assets);
    const timelines = createTimelineStore(db);
    unwrap(await timelines.create(document));
    const ids = { project: project.id, timeline: document.id };

    insert(db, ids, {})();
    expect(insert(db, ids, { id: 'c2', anchor: 'not json' })).toThrow(/CHECK/);
    expect(insert(db, ids, { id: 'c3', body: '' })).toThrow(/CHECK/);
    expect(insert(db, ids, { id: 'c4', body: 'x'.repeat(1001) })).toThrow(/CHECK/);
    expect(insert(db, ids, { id: 'c5', author: 'model' })).toThrow(/CHECK/);
    expect(insert(db, ids, { id: 'c6', status: 'done' })).toThrow(/CHECK/);
    expect(insert(db, ids, { id: 'c7', reply: 'x'.repeat(301) })).toThrow(/CHECK/);
    expect(insert(db, ids, { id: 'c8', change_refs: '[' })).toThrow(/CHECK/);
    expect(insert(db, { ...ids, timeline: 'missing' }, { id: 'c9' })).toThrow(/FOREIGN KEY/);

    unwrap(await timelines.remove(document.id));
    expect(db.driver.prepare('SELECT count(*) AS n FROM timeline_comments').get()).toEqual({ n: 0 });

    unwrap(db.migrateTo(39));
    expect(tables(db)).toEqual([]);
    unwrap(db.migrateTo(40));
    expect(db.driver.prepare('SELECT count(*) AS n FROM timeline_comments').get()).toEqual({ n: 0 });
  });
});
