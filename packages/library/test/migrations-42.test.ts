// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 42 (HFW1-TPL): projects and templates are wiped, on a made-up library. Two projects with a timeline, a
 * saved version, a comment, commands, a render, chats, memory, a Style choice and a workspace; a template made from
 * one with its kept reel, contact sheet, hub submission and memory; and what must stay: assets and shots, memory and
 * a chat of the user's own, a Style, a folder, an Instagram save, settings, cloud-call and job history. Opening the
 * library takes the usual backup before it (one, not a second), and that backup still holds what went.
 */
import { join } from 'node:path';
import { RationalTime, unwrap, type TemplateId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { defaultBackupDir, listBackups } from '../src/db/backup';
import { createTemplateStore } from '../src/stores/template-store';
import { createTimelineStore } from '../src/stores/timeline-store';
import { openDatabase, type LibraryDatabase } from '../src/index';
import { openTestDb, tempDir } from './helpers';
import { seed, template, timeline } from './stores/documents';

const fps30 = { num: 30, den: 1 };
const SHA = 'a'.repeat(64);

const run = (db: LibraryDatabase, text: string, ...params: (string | number | null)[]) =>
  db.driver.prepare(text).run(...params);
const count = (db: LibraryDatabase, table: string, where = '1') =>
  Number(db.driver.prepare(`SELECT count(*) AS n FROM "${table}" WHERE ${where}`).get()?.n);
/** Every plain table's row count (FTS tables, their shadows and the migrations table aside). */
const counts = (db: LibraryDatabase) =>
  Object.fromEntries(
    db.driver
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           AND name NOT LIKE '%fts%' AND name != '_migrations' ORDER BY name`,
      )
      .all()
      .map(({ name }) => [String(name), count(db, String(name))]),
  );

/** A made-up library at version 41 with two projects, a template, and what must survive them. */
async function madeUp(db: LibraryDatabase) {
  const { repos, project, assets } = seed(db, 'Made-up trip');
  const other = seed(db, 'Another made-up trip').project;
  const range = { start: RationalTime.of(0, fps30), duration: RationalTime.of(60, fps30) };
  unwrap(repos.shots.replaceForAsset(assets[0], 0, [range]));
  const reel = template();
  unwrap(
    await createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') }).create(reel, {
      name: 'Made-up reel',
      projectId: project.id,
      listed: true,
    }),
  );
  const tpl = reel.id as TemplateId;
  const made = timeline(project.id, assets, { template: { id: tpl, version: 1 } });
  unwrap(await createTimelineStore(db).create(made));
  run(
    db,
    `INSERT INTO timeline_versions (id, timeline_id, number, kind, schema_version, document, revision, document_hash,
       created_at) VALUES ('v1', ?, 2, 'named', 1, '{}', 1, ?, 1)`,
    made.id,
    SHA,
  );
  run(
    db,
    `INSERT INTO timeline_comments (id, project_id, timeline_id, anchor, body, author, status, created_at, updated_at)
     VALUES ('c1', ?, ?, '{}', 'Made-up note', 'user', 'open', 1, 1)`,
    project.id,
    made.id,
  );
  run(
    db,
    `INSERT INTO renders (id, project_id, timeline_id, timeline_revision, preset_id, status, name, width, height,
       rate_num, rate_den, duration_frames, music, captions, notify, request, request_key, created_at)
     VALUES ('r1', ?, ?, 1, 'reels', 'ready', 'Made-up export', 1080, 1920, 30, 1, 150, 'none', '{}', 0, '{}', 'k1', 1)`,
    project.id,
    made.id,
  );
  const command = (id: string, projectId: string | null, seq: number) =>
    run(
      db,
      `INSERT INTO commands (id, project_id, seq, name, payload, source, actor, side_effect, created_at, group_id)
       VALUES (?, ?, ?, 'timeline.update', '{}', 'agent', 'agent:run', 'write', 1, 'turn-1')`,
      id,
      projectId,
      seq,
    );
  command('cmd1', project.id, 1);
  command('cmd2', other.id, 1);
  command('cmd3', null, 1);
  for (const [id, projectId] of [
    ['chat-project', project.id],
    ['chat-own', null],
  ] as const) {
    run(
      db,
      'INSERT INTO conversations (id, project_id, created_at, updated_at) VALUES (?, ?, 1, 1)',
      id,
      projectId,
    );
    run(
      db,
      `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', '"Made up"', 1)`,
      `m-${id}`,
      id,
    );
    run(
      db,
      `INSERT INTO tool_runs (id, conversation_id, message_id, tool_name, tool_version, status, input, started_at)
       VALUES (?, ?, ?, 'timeline.get', '1', 'succeeded', '{}', 1)`,
      `t-${id}`,
      id,
      `m-${id}`,
    );
  }
  run(
    db,
    `INSERT INTO chat_cards (conversation_id, card_id, card, created_at, updated_at) VALUES ('chat-project', 'k', '{}', 1, 1)`,
  );
  run(
    db,
    `INSERT INTO agent_runs (run_id, conversation_id, status, last_seq, started_at, updated_at)
     VALUES ('run1', 'chat-project', 'succeeded', 0, 1, 1)`,
  );
  run(
    db,
    `INSERT INTO trace_runs (run_id, conversation_id, status, message, started_at) VALUES ('run1', 'chat-project', 'succeeded', 'x', 1)`,
  );
  const memory = (id: string, scope: string, projectId: string | null, templateId: string | null) =>
    run(
      db,
      `INSERT INTO memory_items (id, scope, project_id, template_id, text, source, conversation_id, revision,
         created_at, updated_at) VALUES (?, ?, ?, ?, 'Made-up note', 'user', 'chat-project', 1, 1, 1)`,
      id,
      scope,
      projectId,
      templateId,
    );
  memory('mem-own', 'user', null, null);
  memory('mem-project', 'project', project.id, null);
  memory('mem-template', 'template', null, tpl);
  run(
    db,
    `INSERT INTO project_styles (project_id, source_key, updated_at) VALUES (?, 'folder:f1', 1)`,
    project.id,
  );
  run(
    db,
    `INSERT INTO workspace_revisions (project_id, revision, base, files, file_count, bytes, origin, created_at)
     VALUES (?, 1, 0, '[]', 0, 0, 'agent', 1)`,
    project.id,
  );
  run(db, 'INSERT INTO workspace_heads (project_id, revision, updated_at) VALUES (?, 1, 1)', project.id);
  const job = (id: string, state: string, projectId: string | null) =>
    run(
      db,
      `INSERT INTO jobs (id, kind, state, resource_class, payload, project_id, created_at, updated_at)
       VALUES (?, 'render.export', ?, 'video', '{}', ?, 1, 1)`,
      id,
      state,
      projectId,
    );
  job('job-queued', 'queued', project.id);
  job('job-done', 'succeeded', project.id);
  job('job-own', 'queued', null);
  run(
    db,
    `INSERT INTO cloud_calls (id, module, provider, model, latency_ms, outcome, project_id, started_at)
     VALUES ('call1', 'agent', 'anthropic', 'made-up', 1, 'ok', ?, 1)`,
    project.id,
  );
  run(
    db,
    'INSERT INTO generated_assets (asset_id, project_id, created_at) VALUES (?, ?, 1)',
    assets[1],
    project.id,
  );
  run(
    db,
    `INSERT INTO template_media (template_id, file, bytes, duration_ms, sha256, has_audio, source, kept_at)
     VALUES (?, 'reference.mp4', 10, 1500, ?, 1, 'file', 1)`,
    tpl,
    SHA,
  );
  run(
    db,
    `INSERT INTO template_assets (sha256, media_type, bytes, created_at) VALUES (?, 'image/jpeg', 1, 1)`,
    SHA,
  );
  run(
    db,
    `INSERT INTO hub_submissions (id, hub_id, version, template_id, template_version, state, created_at)
     VALUES ('h1', 'hub', 1, ?, 1, 'open', 1)`,
    tpl,
  );
  run(db, `INSERT INTO instagram_collections (id, name, updated_at) VALUES ('col', 'Made-up saves', 1)`);
  run(
    db,
    `INSERT INTO instagram_saved_reels (shortcode, media_pk, collection_id, permalink, saved_at, template_id)
     VALUES ('abc', '1', 'col', 'https://example.com/abc', 1, ?)`,
    tpl,
  );
  run(
    db,
    `INSERT INTO styles (id, name, kind, revision, schema_version, document, made_from_template_id, made_from_version,
       created_at, updated_at) VALUES ('style1', 'Made-up look', 'look', 1, 1, '{}', ?, 1, 1, 1)`,
    tpl,
  );
  run(
    db,
    `INSERT INTO template_folders (id, name, name_key, created_at) VALUES ('f1', 'Made-up', 'made-up', 1)`,
  );
  run(db, `INSERT INTO settings (key, value, updated_at) VALUES ('made.up', '1', 1)`);
}

const WIPED = [
  'chat_cards',
  'hub_submissions',
  'project_styles',
  'projects',
  'renders',
  'template_assets',
  'template_media',
  'template_versions',
  'templates',
  'timeline_asset_refs',
  'timeline_comments',
  'timeline_versions',
  'timelines',
  'workspace_heads',
  'workspace_revisions',
];
/** Tables that keep only what was not a project's or a template's. */
const THINNED: Record<string, number> = {
  commands: 1,
  conversations: 1,
  jobs: 2,
  memory_items: 1,
  messages: 1,
  tool_runs: 1,
};

describe('migration 42: wipe projects and templates', () => {
  it('wipes every project and template with what hangs off them, and keeps the rest', async () => {
    const path = join(tempDir(), 'library.db');
    const old = openTestDb({ path, targetVersion: 41 });
    await madeUp(old);
    const before = counts(old);
    for (const table of [...WIPED, ...Object.keys(THINNED)]) expect(before[table], table).toBeGreaterThan(0);
    old.close();

    const db = unwrap(openDatabase({ path, targetVersion: 42 }));
    try {
      expect(db.schemaVersion()).toBe(42);
      const after = counts(db);
      for (const table of WIPED) expect(after[table], table).toBe(0);
      for (const [table, left] of Object.entries(THINNED)) expect(after[table], table).toBe(left);
      for (const [table, rows] of Object.entries(before))
        if (!WIPED.includes(table) && !(table in THINNED)) expect(after[table], table).toBe(rows);
      expect(count(db, 'template_fts')).toBe(0);
      // What stays has no project or template, and points at nothing that went.
      expect(db.driver.prepare('SELECT id FROM conversations').all()).toEqual([{ id: 'chat-own' }]);
      expect(db.driver.prepare('SELECT id, conversation_id FROM memory_items').all()).toEqual([
        { id: 'mem-own', conversation_id: null },
      ]);
      expect(db.driver.prepare('SELECT id FROM jobs ORDER BY id').all()).toEqual([
        { id: 'job-done' },
        { id: 'job-own' },
      ]);
      for (const [table, column] of [
        ['jobs', 'project_id'],
        ['cloud_calls', 'project_id'],
        ['generated_assets', 'project_id'],
        ['agent_runs', 'conversation_id'],
        ['trace_runs', 'conversation_id'],
        ['instagram_saved_reels', 'template_id'],
      ] as const)
        expect(count(db, table, `${column} IS NOT NULL`), `${table}.${column}`).toBe(0);
      expect(db.driver.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

      // The open took its one backup first, at version 41, and it still holds what went.
      expect(db.opened.migration?.backup?.reason).toBe('pre-migrate-to-v42');
      const backups = listBackups(path, defaultBackupDir(path));
      expect(backups.filter((backup) => backup.reason === 'pre-migrate-to-v42')).toHaveLength(1);
      const saved = unwrap(openDatabase({ path: backups[0]!.path, targetVersion: 41 }));
      try {
        expect(count(saved, 'projects')).toBe(2);
        expect(count(saved, 'templates')).toBe(1);
      } finally {
        saved.close();
      }

      // Down brings nothing back; up again on what is left changes nothing.
      unwrap(db.migrateTo(41));
      expect(count(db, 'projects')).toBe(0);
      unwrap(db.migrateTo(42));
      expect(counts(db)).toEqual(after);
    } finally {
      db.close();
    }
  });
});
