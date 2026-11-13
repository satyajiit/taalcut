// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 41 (HFW1-WS): `workspace_revisions` and `workspace_heads`. The checks hold a row to core's
 * WorkspaceRevision: a revision from 1 written over an earlier one, files as a JSON array, the limits, a known
 * origin, a command that made at most one revision. Both go with their project. Down removes them; up again starts
 * empty.
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';
import { seed } from './stores/documents';

const insert = (db: LibraryDatabase, projectId: string, row: Record<string, string | number | null> = {}) => {
  const values = {
    revision: 1,
    base: 0,
    files: '[]',
    file_count: 0,
    bytes: 0,
    origin: 'agent',
    command_id: null,
    ...row,
  };
  return () =>
    db.driver
      .prepare(
        `INSERT INTO workspace_revisions (project_id, revision, base, files, file_count, bytes, origin, command_id,
           created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        projectId,
        values.revision,
        values.base,
        values.files,
        values.file_count,
        values.bytes,
        values.origin,
        values.command_id,
      );
};

const tables = (db: LibraryDatabase) =>
  db.driver
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'workspace_%' ORDER BY name")
    .all()
    .map((row) => row.name);

describe('migration 41: workspaces', () => {
  it('holds rows to the revision shape, goes with the project, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 41 });
    const { project } = seed(db);
    insert(db, project.id)();
    insert(db, project.id, { revision: 2, base: 1, command_id: 'c1' })();
    const refused: Record<string, string | number>[] = [
      { revision: 0 },
      { revision: 3, base: 3 },
      { revision: 3, files: '{}' },
      { revision: 3, files: 'not json' },
      { revision: 3, file_count: 513 },
      { revision: 3, bytes: 2 * 1024 * 1024 + 1 },
      { revision: 3, origin: 'model' },
      { revision: 3, command_id: 'c1' },
      { revision: 2 },
    ];
    for (const bad of refused) expect(insert(db, project.id, bad), JSON.stringify(bad)).toThrow();
    db.driver
      .prepare('INSERT INTO workspace_heads (project_id, revision, updated_at) VALUES (?, 2, 1)')
      .run(project.id);
    const other = seed(db, 'Other').project;
    const head = (projectId: string, revision: number) => () =>
      db.driver
        .prepare('INSERT INTO workspace_heads (project_id, revision, updated_at) VALUES (?, ?, 1)')
        .run(projectId, revision);
    expect(head(other.id, -1)).toThrow(/CHECK/);
    expect(head('missing', 1)).toThrow(/FOREIGN KEY/);

    db.driver.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    expect(db.driver.prepare('SELECT count(*) AS n FROM workspace_revisions').get()?.n).toBe(0);
    expect(db.driver.prepare('SELECT count(*) AS n FROM workspace_heads').get()?.n).toBe(0);

    expect(tables(db)).toEqual(['workspace_heads', 'workspace_revisions', 'workspace_revisions_command_uq']);
    unwrap(db.migrateTo(40));
    expect(tables(db)).toEqual([]);
    unwrap(db.migrateTo(41));
    expect(tables(db)).toEqual(['workspace_heads', 'workspace_revisions', 'workspace_revisions_command_uq']);
  });
});
