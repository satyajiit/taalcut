// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-STY: the style profile store over migration 31. A set's members come from the library's own tables
 * (a Saved collection's linked Reels, a folder, a tag, finished exports), unarchived and in id order; a gone
 * collection or folder is not_found. Profiles are derived rows: a row that no longer parses reads as absent, and a
 * summary lands only on the profile it was written for. A project's style is staged with its command and goes
 * with the project.
 */
import { join } from 'node:path';
import {
  ALL_SAVED_COLLECTION_ID,
  createCommandBus,
  defineCommand,
  err,
  idSchema,
  newId,
  ok,
  systemClock,
  UnknownError,
  unwrap,
  type StyleProfile,
  type StyleProfileRecord,
  type StyleSource,
  type TemplateFolderId,
  type TemplateId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createCommandUnitOfWork,
  createStyleProfileStore,
  createTemplateStore,
  createTimelineStore,
  type LibraryDatabase,
} from '../../src/index';
import { fakeClock, openTestDb, tempDir } from '../helpers';
import { seed, template, timeline } from '../stores/documents';

const band = { n: 2, q1: 0.8, median: 1, q3: 1.2 };
const profile: StyleProfile = {
  algorithm: 'style-profile.v1',
  members: 2,
  pacing: { shot: band, cutsOnBeat: 0.5, withBeats: 2, shotsInFirst3s: { n: 2, q1: 2, median: 3, q3: 3 } },
  hook: {
    shotType: [{ value: 'close', count: 2 }],
    duration: band,
    withText: 1,
    reveal: [{ value: 'pop', count: 1 }],
    role: [{ value: 'title', count: 1 }],
    textExamples: ['3 cafes you missed'],
  },
  mix: { transitions: [{ value: 'cut', count: 4 }], slots: 6, speedRamps: 0, rampCurves: [] },
  overlays: {
    count: 1,
    withText: 1,
    position: [{ value: 'top', count: 1 }],
    size: [{ value: 'large', count: 1 }],
    reveal: [{ value: 'pop', count: 1 }],
    case: [{ value: 'mixed', count: 1 }],
    background: [{ value: 'none', count: 1 }],
    wordsPerLine: { n: 1, q1: 4, median: 4, q3: 4 },
  },
  audio: { kind: [{ value: 'music', count: 2 }], loudnessLufs: -14.2, energy: null },
  form: { length: { n: 2, q1: 6, median: 6.5, q3: 7 }, aspect: [{ value: '9:16', count: 2 }] },
  exemplars: [],
  exemplarPool: 0,
  exemplarIndex: null,
};

const SAVED: StyleSource = { kind: 'instagram-collection', collectionId: 'col_a' };
const record = (overrides: Partial<StyleProfileRecord> = {}): StyleProfileRecord => ({
  source: SAVED,
  digest: 'a'.repeat(64),
  profile,
  summary: { state: 'writing', at: 1 },
  builtAt: 1,
  ...overrides,
});

/** Four templates (t[0] oldest); Travel links two, Food one (All saved: every linked Reel); a folder and a tag. */
async function library() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const templates = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
  const t: TemplateId[] = [];
  for (let n = 0; n < 4; n++) {
    clock.advance(1000);
    const made = unwrap(
      await templates.create(template({ id: newId<'Template'>() }), {
        name: `T${n}`,
        projectId: null,
        listed: true,
      }),
    );
    t.push(made.id);
  }
  const sql = (text: string, ...values: (string | number | null)[]) => db.driver.prepare(text).run(...values);
  sql(
    `INSERT INTO instagram_collections (id, name, updated_at) VALUES ('col_a', 'Travel', 1), ('col_b', 'Food', 1),
       (?, 'All saved', 1)`,
    ALL_SAVED_COLLECTION_ID,
  );
  const reel = (code: string, collection: string, templateId: TemplateId | null) =>
    sql(
      `INSERT INTO instagram_saved_reels (shortcode, media_pk, collection_id, permalink, saved_at, template_id)
       VALUES (?, ?, ?, 'https://www.instagram.com/reel/x/', 1, ?)`,
      code,
      code,
      collection,
      templateId,
    );
  reel('r0', 'col_a', t[0] ?? null);
  reel('r1', 'col_a', t[1] ?? null);
  reel('r2', 'col_a', null);
  reel('r3', 'col_b', t[2] ?? null);
  const folderId: TemplateFolderId = newId<'TemplateFolder'>();
  sql(
    `INSERT INTO template_folders (id, name, name_key, created_at) VALUES (?, 'Hooks', 'hooks', 1)`,
    folderId,
  );
  sql(`UPDATE templates SET folder_id = ? WHERE id IN (?, ?)`, folderId, t[1] ?? '', t[3] ?? '');
  sql(`UPDATE templates SET tags = '["travel-vlog"]' WHERE id IN (?, ?)`, t[0] ?? '', t[2] ?? '');
  return { db, clock, t, folderId, sql, store: createStyleProfileStore(db) };
}

const ids = (refs: readonly { id: TemplateId }[]) => refs.map((ref) => ref.id);
const sorted = (values: readonly (TemplateId | undefined)[]) =>
  values.flatMap((value) => (value ? [value] : [])).sort();

/** A project whose timeline was cast from `templateId` and exported (`status`, deleted at `deletedAt`). */
async function exported(
  db: LibraryDatabase,
  templateId: TemplateId | undefined,
  status: string,
  deletedAt: number | null,
) {
  const { project, assets } = seed(db, `Exports ${status} ${deletedAt ?? ''}`);
  const doc = timeline(project.id, assets, { template: templateId ? { id: templateId, version: 1 } : null });
  unwrap(await createTimelineStore(db).create(doc));
  db.driver
    .prepare(
      `INSERT INTO renders (id, project_id, timeline_id, timeline_revision, preset_id, status, name, width, height,
         rate_num, rate_den, duration_frames, music, captions, notify, request, request_key, created_at, deleted_at)
       VALUES (?, ?, ?, 1, 'reels', ?, 'Export', 1080, 1920, 30, 1, 900, 'platformSound', '{}', 0, '{}', ?, 1, ?)`,
    )
    .run(newId<'Render'>(), project.id, doc.id, status, `key-${status}-${deletedAt}`, deletedAt);
}

describe('style profile members (LRN1-STY)', () => {
  it("reads each kind of set from the library's tables, unarchived, in id order", async () => {
    const { db, t, folderId, sql, store } = await library();
    expect(ids(unwrap(await store.members(SAVED)))).toEqual(sorted([t[0], t[1]]));
    expect(
      ids(
        unwrap(await store.members({ kind: 'instagram-collection', collectionId: ALL_SAVED_COLLECTION_ID })),
      ),
    ).toEqual(sorted([t[0], t[1], t[2]]));
    expect(ids(unwrap(await store.members({ kind: 'folder', folderId })))).toEqual(sorted([t[1], t[3]]));
    expect(ids(unwrap(await store.members({ kind: 'tag', tag: 'travel-vlog' })))).toEqual(
      sorted([t[0], t[2]]),
    );
    expect(unwrap(await store.members({ kind: 'tag', tag: 'nothing' }))).toEqual([]);
    expect(unwrap(await store.members(SAVED))[0]).toMatchObject({ version: 1 });

    await exported(db, t[3], 'ready', null);
    await exported(db, t[2], 'ready', 5);
    await exported(db, t[1], 'failed', null);
    await exported(db, undefined, 'ready', null);
    expect(ids(unwrap(await store.members({ kind: 'my-exports' })))).toEqual([t[3]]);

    sql(`UPDATE templates SET archived_at = 9 WHERE id = ?`, t[0] ?? '');
    expect(ids(unwrap(await store.members(SAVED)))).toEqual([t[1]]);
  });

  it('names a set, and says not_found for a collection or folder that is gone', async () => {
    const { folderId, store } = await library();
    expect(unwrap(await store.sourceName(SAVED))).toBe('Travel');
    expect(unwrap(await store.sourceName({ kind: 'folder', folderId }))).toBe('Hooks');
    expect(unwrap(await store.sourceName({ kind: 'tag', tag: 'travel-vlog' }))).toBe('travel-vlog');
    expect(unwrap(await store.sourceName({ kind: 'my-exports' }))).toBeNull();
    const gone = await store.members({ kind: 'instagram-collection', collectionId: 'col_gone' });
    expect(!gone.ok && gone.error.code).toBe('core.not_found');
    const noFolder = await store.sourceName({ kind: 'folder', folderId: newId<'TemplateFolder'>() });
    expect(!noFolder.ok && noFolder.error.code).toBe('core.not_found');
  });
});

describe('style profile records (LRN1-STY)', () => {
  it('replaces a set’s row, lists the stamps, and removes it', async () => {
    const { store } = await library();
    expect(unwrap(await store.get(SAVED))).toBeNull();
    unwrap(await store.put(record()));
    expect(unwrap(await store.get(SAVED))).toEqual(record());
    const empty = record({ source: { kind: 'tag', tag: 'nothing' }, profile: null, digest: 'b'.repeat(64) });
    unwrap(await store.put({ ...empty, summary: { state: 'none', reason: 'empty', at: 1 } }));
    unwrap(await store.put(record({ digest: 'c'.repeat(64), builtAt: 2 })));
    expect(unwrap(await store.list())).toEqual([
      { source: SAVED, digest: 'c'.repeat(64) },
      { source: { kind: 'tag', tag: 'nothing' }, digest: 'b'.repeat(64) },
    ]);
    unwrap(await store.remove(SAVED));
    expect(unwrap(await store.get(SAVED))).toBeNull();
  });

  it('writes a summary only onto the profile it was written for', async () => {
    const { store } = await library();
    unwrap(await store.put(record()));
    const written = {
      state: 'written',
      text: 'Fast.',
      provider: 'local',
      model: 'qwen',
      local: true,
      at: 2,
    } as const;
    expect(unwrap(await store.setSummary(SAVED, 'f'.repeat(64), written))).toBe(false);
    expect(unwrap(await store.get(SAVED))?.summary.state).toBe('writing');
    expect(unwrap(await store.setSummary(SAVED, 'a'.repeat(64), written))).toBe(true);
    expect(unwrap(await store.get(SAVED))?.summary).toEqual(written);
  });

  it('reads a row that no longer parses as absent, so it is rebuilt', async () => {
    const { db, store } = await library();
    unwrap(await store.put(record()));
    db.driver.prepare(`UPDATE style_profiles SET profile = '{"algorithm":"style-profile.v0"}'`).run();
    expect(unwrap(await store.get(SAVED))).toBeNull();
    db.driver.prepare(`UPDATE style_profiles SET source_key = 'tag:Not Normal'`).run();
    expect(unwrap(await store.list())).toEqual([]);
  });
});

describe('project styles (LRN1-STY)', () => {
  it('records the set a project follows, clears it, and goes with the project', async () => {
    const { db, store } = await library();
    const { project, repos } = seed(db);
    const missing = await store.setProjectStyle(newId<'Project'>(), SAVED);
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
    unwrap(await store.setProjectStyle(project.id, SAVED));
    expect(unwrap(await store.projectStyle(project.id))).toEqual(SAVED);
    unwrap(await store.setProjectStyle(project.id, { kind: 'my-exports' }));
    expect(unwrap(await store.projectStyle(project.id))).toEqual({ kind: 'my-exports' });
    unwrap(await store.setProjectStyle(project.id, null));
    expect(unwrap(await store.projectStyle(project.id))).toBeNull();
    unwrap(await store.setProjectStyle(project.id, SAVED));
    unwrap(repos.projects.remove(project.id));
    expect(db.driver.prepare('SELECT count(*) AS n FROM project_styles').get()).toEqual({ n: 0 });
  });

  it('stages the choice with a command context: nothing lands unless the command commits', async () => {
    const { db } = await library();
    const { project } = seed(db);
    const commands = createCommandUnitOfWork(db);
    const store = createStyleProfileStore(db, { commands });
    const use = defineCommand({
      name: 'styleProfile.use',
      payload: z.object({ projectId: idSchema<'Project'>(), fail: z.boolean() }),
      sideEffect: 'write',
      handle: commands.handle(async ({ projectId, fail }, context) => {
        const set = await store.setProjectStyle(projectId, SAVED, context);
        if (!set.ok) return set;
        expect(unwrap(await store.projectStyle(projectId))).toBeNull();
        return fail ? err(UnknownError()) : ok({ result: null });
      }),
    });
    const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
    bus.register(use);
    const person = { source: 'ui', actor: 'user' } as const;
    expect((await bus.dispatch(use, { projectId: project.id, fail: true }, person)).ok).toBe(false);
    expect(unwrap(await store.projectStyle(project.id))).toBeNull();
    unwrap(await bus.dispatch(use, { projectId: project.id, fail: false }, person));
    expect(unwrap(await store.projectStyle(project.id))).toEqual(SAVED);
  });
});
