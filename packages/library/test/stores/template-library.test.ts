// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V14: the template store keeps each lineage's library metadata (tags, folder, favourite, trend date,
 * provenance) without a new version, and `list` serves every filter and sort of core's query, keyset-paged.
 */
import { join } from 'node:path';
import {
  createCommandBus,
  defineCommand,
  idSchema,
  newId,
  ok,
  STALE_AFTER_DAYS_SETTING,
  systemClock,
  unwrap,
  type TemplateListQuery,
  type TemplateProvenance,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createCommandUnitOfWork,
  createSettingsRepository,
  createTemplateFolderStore,
  createTemplateStore,
  createTimelineStore,
  type LibraryDatabase,
} from '../../src/index';
import { fakeClock, openTestDb, tempDir } from '../helpers';
import { seed, template, timeline } from './documents';
import { formatTemplate } from './style-documents';

const base = { includeUnlisted: false, includeArchived: false, limit: 50 } as const;
const hub: TemplateProvenance = {
  kind: 'hub',
  hubId: newId<'HubTemplate'>(),
  version: 2,
  handle: 'goa-creator',
  licence: 'CC0-1.0',
  forkedAt: 5,
  removed: false,
};

function setup(db: LibraryDatabase = openTestDb({ file: false })) {
  const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
  return { db, store, folders: createTemplateFolderStore(db) };
}

async function names(store: ReturnType<typeof setup>['store'], query: Partial<TemplateListQuery>) {
  return unwrap(await store.list({ ...base, ...query })).items.map((item) => item.name);
}

/** Every page of `query` at `limit` 2, joined: the same as one page when the cursor is right. */
async function paged(store: ReturnType<typeof setup>['store'], query: Partial<TemplateListQuery>) {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = unwrap(await store.list({ ...base, ...query, limit: 2, cursor }));
    out.push(...page.items.map((item) => item.name));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return out;
}

describe('template library metadata (P3-V14)', () => {
  it('keeps provenance and a trend date from create, and every path reads the same summary', async () => {
    const { store } = setup();
    const doc = template();
    const trendFreshness = { date: '2026-09-01', source: 'reference' as const };
    const made = unwrap(
      await store.create(doc, {
        name: 'Forked',
        projectId: null,
        listed: true,
        provenance: hub,
        trendFreshness,
      }),
    );
    expect(made).toMatchObject({
      provenance: hub,
      trendFreshness,
      tags: [],
      folderId: null,
      favourite: false,
    });
    expect(made).toMatchObject({ formatId: null, language: 'en', styleId: null, slotStrip: [30, 30, 30] });
    expect(unwrap(await store.list(base)).items).toEqual([made]);
    expect(unwrap(await store.get(doc.id)).summary).toEqual(made);
    const bad = await store.create(template(), {
      name: 'Bad',
      projectId: null,
      listed: true,
      provenance: { ...hub, version: 0 },
    });
    expect(!bad.ok && bad.error.code).toBe('core.validation');
  });

  it('sets tags, favourite, trend date, provenance and folder without a new version', async () => {
    const { store, folders } = setup();
    const doc = template();
    unwrap(await store.create(doc, { name: 'Trip', projectId: null, listed: true }));
    const folderId = newId<'TemplateFolder'>();
    unwrap(await folders.create({ id: folderId, name: 'Travel' }));
    const set = unwrap(
      await store.setMeta(doc.id, {
        tags: [' Beach Day ', 'beach-day', 'गोवा'],
        favourite: true,
        folderId,
        trendFreshness: { date: '2026-08-01', source: 'user' },
        provenance: { kind: 'file', importedAt: 9, hubId: null },
      }),
    );
    expect(set).toMatchObject({ tags: ['beach-day', 'गोवा'], favourite: true, folderId, head: 1 });
    expect(unwrap(await store.get(doc.id)).summary).toEqual(set);
    expect(unwrap(await store.versions(doc.id))).toHaveLength(1);
    const cleared = unwrap(
      await store.setMeta(doc.id, { folderId: null, trendFreshness: null, provenance: null }),
    );
    expect(cleared).toMatchObject({
      folderId: null,
      trendFreshness: null,
      provenance: null,
      favourite: true,
    });
    for (const patch of [
      { tags: ['no spaces!'] },
      { tags: Array.from({ length: 13 }, (_, i) => `t${i}`) },
      { trendFreshness: { date: '1 Aug', source: 'user' as const } },
    ]) {
      const refused = await store.setMeta(doc.id, patch);
      expect(!refused.ok && refused.error.code).toBe('core.validation');
    }
    const nowhere = await store.setMeta(doc.id, { folderId: newId<'TemplateFolder'>() });
    expect(!nowhere.ok && nowhere.error.code).toBe('templates.folder_not_found');
  });

  it('filters by tags, folder, favourite, format, language, origin and text over tags', async () => {
    const { store, folders } = setup();
    const folderId = newId<'TemplateFolder'>();
    unwrap(await folders.create({ id: folderId, name: 'Travel' }));
    const reel = template();
    const vlog = formatTemplate({ formatId: 'vlog', language: 'hi' });
    const tutorial = formatTemplate({ formatId: 'tutorial', language: 'es' });
    unwrap(await store.create(reel, { name: 'Reel', projectId: null, listed: true }));
    unwrap(await store.create(vlog, { name: 'Vlog', projectId: null, listed: true }));
    unwrap(await store.create(tutorial, { name: 'How to', projectId: null, listed: true }));
    unwrap(await store.setMeta(reel.id, { tags: ['monsoon', 'beach'], folderId }));
    unwrap(await store.setMeta(vlog.id, { tags: ['beach'], favourite: true }));
    const sorted = async (query: Partial<TemplateListQuery>) => (await names(store, query)).sort();
    expect(await sorted({ tags: ['monsoon', 'city'] })).toEqual(['Reel']);
    expect(await sorted({ tags: ['beach'] })).toEqual(['Reel', 'Vlog']);
    expect(await sorted({ folderId })).toEqual(['Reel']);
    expect(await sorted({ folderId: 'none' })).toEqual(['How to', 'Vlog']);
    expect(await sorted({ favourite: true })).toEqual(['Vlog']);
    expect(await sorted({ favourite: false })).toEqual(['How to', 'Reel']);
    expect(await sorted({ formatId: 'tutorial' })).toEqual(['How to']);
    expect(await sorted({ language: 'hi' })).toEqual(['Vlog']);
    expect(await sorted({ origin: 'reference' })).toEqual(['Reel']);
    expect(await sorted({ origin: 'format', tags: ['beach'] })).toEqual(['Vlog']);
    expect(await sorted({ query: 'monso' })).toEqual(['Reel']); // a tag, by prefix
    unwrap(await store.setMeta(reel.id, { tags: [] }));
    expect(await sorted({ query: 'monsoon' })).toEqual([]);
  });

  it('filters stale trend dates by templates.staleAfterDays (default 90)', async () => {
    const clock = fakeClock(); // 2026-10-12
    const { db, store } = setup(openTestDb({ file: false, clock: clock.now }));
    const dated = [
      ['Old', '2026-07-13'],
      ['Edge', '2026-07-14'],
      ['New', '2026-10-01'],
      ['Undated', null],
    ] as const;
    for (const [name, date] of dated) {
      const trendFreshness = date ? { date, source: 'reference' as const } : null;
      unwrap(await store.create(template(), { name, projectId: null, listed: true, trendFreshness }));
    }
    const sorted = async (query: Partial<TemplateListQuery>) => (await names(store, query)).sort();
    // 2026-07-13 is 91 days before 2026-10-12; 2026-07-14 exactly 90 (not older).
    expect(await sorted({ stale: true })).toEqual(['Old']);
    expect(await sorted({ stale: false })).toEqual(['Edge', 'New', 'Undated']);
    unwrap(createSettingsRepository(db).set(STALE_AFTER_DAYS_SETTING.key, 7));
    expect(await sorted({ stale: true })).toEqual(['Edge', 'New', 'Old']);
  });

  it('sorts by name, trend, favourite, use and change, either way, and pages each sort', async () => {
    const clock = fakeClock();
    const { db, store } = setup(openTestDb({ file: false, clock: clock.now }));
    const timelines = createTimelineStore(db);
    const rows = [
      { name: 'banana', date: '2026-05-01', favourite: true, used: 2 },
      { name: 'Apple', date: null, favourite: false, used: 0 },
      { name: 'cherry', date: '2026-09-01', favourite: false, used: 3 },
      { name: 'date', date: '2026-01-01', favourite: true, used: 1 },
      { name: 'Elder', date: null, favourite: false, used: 1 },
    ];
    for (const row of rows) {
      clock.advance(1000);
      const doc = template();
      const trendFreshness = row.date ? { date: row.date, source: 'user' as const } : null;
      unwrap(await store.create(doc, { name: row.name, projectId: null, listed: true, trendFreshness }));
      unwrap(await store.setMeta(doc.id, { favourite: row.favourite }));
      for (let i = 0; i < row.used; i += 1) {
        const { project, assets } = seed(db, `${row.name} ${i}`);
        unwrap(
          await timelines.create(timeline(project.id, assets, { template: { id: doc.id, version: 1 } })),
        );
      }
    }
    const checks: [Partial<TemplateListQuery>, string[]][] = [
      [{}, ['Elder', 'date', 'cherry', 'Apple', 'banana']],
      [{ sort: 'updated', dir: 'asc' }, ['banana', 'Apple', 'cherry', 'date', 'Elder']],
      [{ sort: 'name', dir: 'asc' }, ['Apple', 'banana', 'cherry', 'date', 'Elder']],
      [{ sort: 'name', dir: 'desc' }, ['Elder', 'date', 'cherry', 'banana', 'Apple']],
      [{ sort: 'trend', dir: 'desc' }, ['cherry', 'banana', 'date']],
      [{ sort: 'trend', dir: 'asc' }, ['date', 'banana', 'cherry']],
      [{ sort: 'used', dir: 'desc' }, ['cherry', 'banana']],
      [{ sort: 'used', dir: 'asc' }, ['Apple']],
    ];
    for (const [query, start] of checks) {
      const all = await names(store, query);
      expect(all.slice(0, start.length)).toEqual(start);
      expect(all).toHaveLength(5);
      expect(await paged(store, query)).toEqual(all);
    }
    // Undated templates come last, whichever way the trend sort runs.
    expect((await names(store, { sort: 'trend', dir: 'asc' })).slice(3).sort()).toEqual(['Apple', 'Elder']);
    expect((await names(store, { sort: 'favourite', dir: 'desc' })).slice(0, 2).sort()).toEqual([
      'banana',
      'date',
    ]);
    expect(await paged(store, { sort: 'favourite', dir: 'asc' })).toEqual(
      await names(store, { sort: 'favourite', dir: 'asc' }),
    );
    const first = unwrap(await store.list({ ...base, sort: 'name', limit: 2 }));
    expect(first.nextCursor).not.toBeNull();
    for (const cursor of [String(first.nextCursor), 'not a cursor']) {
      const other = await store.list({ ...base, sort: 'used', limit: 2, cursor });
      expect(!other.ok && other.error.code).toBe('core.validation');
    }
  });

  it('stages metadata writes on the command unit of work', async () => {
    const db = openTestDb({ file: false });
    const commands = createCommandUnitOfWork(db);
    const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets'), commands });
    const doc = template();
    unwrap(await store.create(doc, { name: 'Trip', projectId: null, listed: true }));
    const star = defineCommand({
      name: 'template.setFavourite',
      payload: z.object({ templateId: idSchema<'Template'>() }),
      sideEffect: 'write',
      handle: commands.handle(async ({ templateId }, context) => {
        const set = await store.setMeta(templateId, { favourite: true, tags: ['goa'] }, context);
        if (!set.ok) return set;
        expect(unwrap(await store.get(templateId)).summary.favourite).toBe(false); // staged
        return ok({ result: set.value });
      }),
    });
    const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
    bus.register(star);
    unwrap(await bus.dispatch(star, { templateId: doc.id }, { source: 'ui', actor: 'user' }));
    expect(unwrap(await store.get(doc.id)).summary).toMatchObject({ favourite: true, tags: ['goa'] });
    expect(await names(store, { query: 'goa' })).toEqual(['Trip']);
  });
});
