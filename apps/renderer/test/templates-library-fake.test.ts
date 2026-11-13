// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { callRpc, newId, templateSchema, type TemplateSummary } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_HOUR, HOOK_TEST, MORNING, templateIdOf } from '../src/backend/fake/templates/template-data';
import { isStale } from '../src/backend/fake/templates/template-query';
import { seedLibrary } from '../src/backend/fake/templates/template-seed-library';

const big = () => createFakeBackend({ phase2: { library: { tickMs: 0 }, templates: { count: 200 } } });
const small = () => createFakeBackend({ phase2: { library: { tickMs: 0 } } });
type Client = ReturnType<typeof big>['client'];

const dispatch = (client: Client, name: string, payload: unknown) =>
  callRpc(client.commands.dispatch({ name, payload, source: 'ui' }));
const undo = (client: Client) => client.commands.undo({ projectId: null, source: 'ui' });
const all = async (client: Client, query: Parameters<Client['templates']['list']>[0] = {}) =>
  (await client.templates.list({ limit: 200, ...query })).items;
const GOLDEN = templateIdOf(GOLDEN_HOUR);

describe('the fake template library at scale', () => {
  it('seeds a library of the size asked, every template valid, a few archived', async () => {
    for (const seed of seedLibrary(200)) expect(templateSchema.safeParse(seed.template).success).toBe(true);
    const { client } = big();
    const listed = await all(client);
    const archived = await all(client, { includeArchived: true });
    expect(archived).toHaveLength(200);
    expect(listed.length).toBeGreaterThan(190);
    expect(listed.every((item) => !item.archived)).toBe(true);
    expect(new Set(listed.map((item) => item.language))).toEqual(new Set(['en', 'hi', 'es', 'pt-BR']));
    expect(listed.some((item) => item.provenance?.kind === 'hub')).toBe(true);
    expect(listed.some((item) => item.provenance?.kind === 'starter')).toBe(true);
    expect(await client.templates.folders()).toHaveLength(6);
  });

  it('filters as the service does: tags any-of, folder, favourites, language, format, stale, words', async () => {
    const { client } = big();
    const everything = await all(client);
    const tagged = await all(client, { tags: ['food', 'beach'] });
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.every((item) => item.tags.includes('food') || item.tags.includes('beach'))).toBe(true);
    const unfiled = await all(client, { folderId: 'none' });
    expect(unfiled.every((item) => item.folderId === null)).toBe(true);
    const folder = (await client.templates.folders())[0]!;
    const inFolder = await all(client, { folderId: folder.id });
    expect(inFolder.every((item) => item.folderId === folder.id)).toBe(true);
    expect((await all(client, { favourite: true })).every((item) => item.favourite)).toBe(true);
    expect((await all(client, { language: 'hi' })).every((item) => item.language === 'hi')).toBe(true);
    expect((await all(client, { formatId: 'tutorial' })).every((item) => item.formatId === 'tutorial')).toBe(
      true,
    );
    const now = Date.now();
    const stale = await all(client, { stale: true });
    expect(stale.length).toBeGreaterThan(0);
    expect(stale.every((item) => item.trendFreshness && isStale(item.trendFreshness.date, now, 90))).toBe(
      true,
    );
    const fresh = await all(client, { stale: false });
    expect(stale.length + fresh.length).toBe(everything.length);
    const words = await all(client, { query: 'market' });
    expect(words.length).toBeGreaterThan(0);
  });

  it('sorts by name, trend date (none last), favourites and use, and pages with a cursor', async () => {
    const { client } = big();
    const byName = await all(client, { sort: 'name', dir: 'asc' });
    const names = byName.map((item) => item.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const byTrend = await all(client, { sort: 'trend' });
    const dates = byTrend.map((item) => item.trendFreshness?.date ?? null);
    const firstNull = dates.indexOf(null);
    expect(dates.slice(firstNull).every((date) => date === null)).toBe(true);
    const known = dates.slice(0, firstNull) as string[];
    expect(known).toEqual([...known].sort().reverse());
    const favourites = await all(client, { sort: 'favourite' });
    const firstPlain = favourites.findIndex((item) => !item.favourite);
    expect(favourites.slice(firstPlain).every((item) => !item.favourite)).toBe(true);
    const page1 = await client.templates.list({ limit: 50, sort: 'updated' });
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).toBe('50');
    const page2 = await client.templates.list({ limit: 50, sort: 'updated', cursor: page1.nextCursor! });
    expect(page2.items[0]!.updatedAt).toBeLessThanOrEqual(page1.items[49]!.updatedAt);
  });
});

describe('the fake template library commands', () => {
  it('tags, favourites and trend dates change the lineage, with undo', async () => {
    const { client } = small();
    expect(
      (await dispatch(client, 'template.setTags', { templateId: GOLDEN, tags: ['Golden Hour', 'शादी'] })).ok,
    ).toBe(true);
    const tagged = (await client.templates.get({ templateId: GOLDEN })).summary;
    expect(tagged.tags).toEqual(['golden-hour', 'शादी']);
    // No new version: tags sit beside the lineage.
    expect(tagged.head).toBe(2);
    await undo(client);
    expect((await client.templates.get({ templateId: GOLDEN })).summary.tags).toEqual([
      'travel',
      'golden-hour',
    ]);
    await dispatch(client, 'template.setFavourite', { templateId: GOLDEN, favourite: false });
    await dispatch(client, 'template.setTrendDate', {
      templateId: GOLDEN,
      trendFreshness: { date: '2026-10-01', source: 'user' },
    });
    const after = (await client.templates.get({ templateId: GOLDEN })).summary;
    expect(after.favourite).toBe(false);
    expect(after.trendFreshness).toEqual({ date: '2026-10-01', source: 'user' });
    const invalid = await dispatch(client, 'template.setTags', { templateId: GOLDEN, tags: ['no spaces!'] });
    expect(invalid.ok).toBe(false);
  });

  it('moves many templates in one step, refuses an unknown folder, and undo puts each back', async () => {
    const { client } = small();
    const [travel, client2] = await client.templates.folders();
    const ids = [GOLDEN, templateIdOf(MORNING), templateIdOf(HOOK_TEST)];
    const unknown = await dispatch(client, 'template.moveToFolder', {
      templateIds: ids,
      folderId: newId<'TemplateFolder'>(),
    });
    expect(!unknown.ok && unknown.error.code).toBe('templates.folder_not_found');
    expect(
      (await dispatch(client, 'template.moveToFolder', { templateIds: ids, folderId: client2!.id })).ok,
    ).toBe(true);
    expect((await all(client, { folderId: client2!.id })).map((item) => item.id).sort()).toEqual(
      [...ids].sort(),
    );
    await undo(client);
    const folderOf = async (id: string) =>
      (await all(client)).find((item: TemplateSummary) => item.id === id)?.folderId;
    expect(await folderOf(GOLDEN)).toBe(travel!.id);
    expect(await folderOf(templateIdOf(MORNING))).toBeNull();
  });

  it('folders: names are unique ignoring case; delete moves templates out and undo restores them', async () => {
    const { client } = small();
    const folderId = newId<'TemplateFolder'>();
    expect((await dispatch(client, 'templateFolder.create', { folderId, name: 'Reels' })).ok).toBe(true);
    const taken = await dispatch(client, 'templateFolder.create', { folderId: newId(), name: 'TRAVEL' });
    expect(!taken.ok && taken.error.code).toBe('templates.folder_name_taken');
    const renamed = await dispatch(client, 'templateFolder.rename', { folderId, name: 'Reels 2026' });
    expect(renamed.ok).toBe(true);
    const [travel] = await client.templates.folders();
    expect(travel!.templates).toBe(1);
    expect((await dispatch(client, 'templateFolder.delete', { folderId: travel!.id })).ok).toBe(true);
    expect((await client.templates.get({ templateId: GOLDEN })).summary.folderId).toBeNull();
    await undo(client);
    expect((await client.templates.get({ templateId: GOLDEN })).summary.folderId).toBe(travel!.id);
    expect((await client.templates.folders()).map((folder) => folder.name)).toEqual([
      'Travel',
      'Client work',
      'Reels 2026',
    ]);
  });

  it('exports a template file and imports it back, all or nothing, one undo', async () => {
    const { client, controls } = small();
    const file = await client.templates.exportDocument({ templateId: GOLDEN });
    expect(file.fileName).toBe('golden-hour-market.taalcut-template');
    expect(file.text).not.toContain('instagram.com');
    expect(await client.files.saveTemplateAs({ templateId: GOLDEN })).toEqual({
      saved: true,
      fileName: file.fileName,
    });
    // A file that isn't from the hub gets a new hub id each time; the rest matches.
    expect(controls.templateLibrary.saved.at(-1)?.fileName).toBe(file.fileName);
    const good = { templateId: newId<'Template'>(), text: file.text };
    const bad = { templateId: newId<'Template'>(), text: '{"format":"taalcut.template"}' };
    const refused = await dispatch(client, 'template.import', { items: [good, bad] });
    expect(!refused.ok && refused.error.code).toBe('templates.import_invalid');
    expect(!refused.ok && refused.error.params?.['file']).toBe(1);
    expect((await all(client)).some((item) => item.id === good.templateId)).toBe(false);
    expect((await dispatch(client, 'template.import', { items: [good] })).ok).toBe(true);
    const imported = (await client.templates.get({ templateId: good.templateId })).summary;
    expect(imported.name).toBe('Golden hour market');
    expect(imported.provenance?.kind).toBe('file');
    expect(imported.origin).toBe('manual');
    await undo(client);
    expect((await all(client)).some((item) => item.id === good.templateId)).toBe(false);
  });

  it('archives with undo, and names a starter fork by its id with starter provenance', async () => {
    const { client } = small();
    await dispatch(client, 'template.archive', { projectId: null, templateId: GOLDEN, archived: true });
    expect((await all(client)).some((item) => item.id === GOLDEN)).toBe(false);
    await undo(client);
    expect((await all(client)).some((item) => item.id === GOLDEN)).toBe(true);
    const templateId = newId<'Template'>();
    expect(
      (await dispatch(client, 'template.addStarter', { starterId: 'weekend-trip', templateId })).ok,
    ).toBe(true);
    const { summary: fork, template } = await client.templates.get({ templateId });
    expect(templateSchema.safeParse(template).success).toBe(true);
    expect(fork.name).toBe('weekend-trip');
    expect(fork.provenance).toEqual({ kind: 'starter', starterId: 'weekend-trip', locale: 'en' });
  });
});
