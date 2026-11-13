// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Contract review P3-1 finding 12: `templates.list` never answers `ok` with an unfiltered page, and a metadata
 * command never answers `ok` with its change dropped. A store that doesn't serve the library metadata is refused
 * with core.not_implemented (feature `templates.library`); one that does filters.
 */
import { describe, expect, it } from 'vitest';
import {
  newId,
  TEMPLATE_COMMANDS,
  templateListQuerySchema,
  type TemplateListQuery,
  type TemplateStore,
} from '@taalcut/core';
import { createImportCommands } from '../../src/library/import-commands';
import { createMetadataCommands } from '../../src/library/metadata-commands';
import { createStarterCommands } from '../../src/starters/starter-commands';
import { starterFiles } from '../../scripts/starter-files';
import { createTemplateService } from '../../src/store/template-service';
import { createMemoryFolderStore } from '../../src/testing/memory-folder-store';
import { requirePlan } from '../formats/helpers';
import { referenceTemplate } from '../helpers/fixtures';
import { unwrap } from '../helpers/result';
import { setupTemplates, UI } from '../helpers/setup';

const N = TEMPLATE_COMMANDS;
const query = (input: Parameters<typeof templateListQuerySchema.parse>[0]): TemplateListQuery =>
  templateListQuerySchema.parse(input);

/** A store that answers list like the library's SQL store does today: recent first, filters ignored. */
function countingStore(inner: TemplateStore) {
  const calls: TemplateListQuery[] = [];
  const store: TemplateStore = {
    ...inner,
    list: (input) => {
      calls.push(input);
      return inner.list(input);
    },
  };
  return { store, calls };
}

async function twoTemplates() {
  const setup = setupTemplates();
  const reference = referenceTemplate();
  const format = { ...requirePlan('vlog', 30), id: newId<'Template'>() };
  unwrap(await setup.store.create(reference, { name: 'Goa reel', projectId: null, listed: true }));
  setup.clock.advance(10);
  unwrap(await setup.store.create(format, { name: 'Vlog plan', projectId: null, listed: true }));
  unwrap(await setup.store.setMeta(reference.id, { favourite: true, tags: ['goa'] }));
  return { ...setup, reference, format };
}

const LIBRARY_QUERIES: readonly [string, Parameters<typeof templateListQuerySchema.parse>[0]][] = [
  ['favourite', { favourite: true }],
  ['tag', { tags: ['goa'] }],
  ['folder', { folderId: newId<'TemplateFolder'>() }],
  ['unfiled', { folderId: 'none' }],
  ['format', { formatId: 'vlog' }],
  ['language', { language: 'en' }],
  ['origin', { origin: 'reference' }],
  ['stale', { stale: true }],
  ['sort', { sort: 'name' }],
  ['direction', { dir: 'asc' }],
];

describe('templates.list on a store without library metadata', () => {
  it.each(LIBRARY_QUERIES)('refuses a %s filter before the store is asked', async (_name, input) => {
    const { store: memory, clock } = await twoTemplates();
    const { store, calls } = countingStore(memory);
    const service = createTemplateService({ store, clock });
    const listed = await service.list(query(input));
    expect(listed.ok).toBe(false);
    if (!listed.ok) {
      expect(listed.error.code).toBe('core.not_implemented');
      expect(listed.error.params).toEqual({ feature: 'templates.library' });
    }
    expect(calls).toHaveLength(0);
  });

  it('keeps the Phase 2 query: no library field, or an empty tag list', async () => {
    const { store, clock, reference, format } = await twoTemplates();
    const service = createTemplateService({ store, clock });
    for (const input of [{}, { tags: [] }, { query: 'goa' }]) {
      const listed = unwrap(await service.list(query(input)));
      expect(listed.items.length).toBeGreaterThan(0);
    }
    const all = unwrap(await service.list(query({})));
    expect(all.items.map((item) => item.id)).toEqual([format.id, reference.id]);
  });
});

describe('templates.list on a store that serves library metadata', () => {
  it('filters and sorts instead of returning the whole page', async () => {
    const { store, clock, reference, format } = await twoTemplates();
    const service = createTemplateService({ store, clock, libraryMetadata: true });
    const ids = async (input: Parameters<typeof templateListQuerySchema.parse>[0]) =>
      unwrap(await service.list(query(input))).items.map((item) => item.id);
    expect(await ids({ favourite: true })).toEqual([reference.id]);
    expect(await ids({ tags: ['goa'] })).toEqual([reference.id]);
    expect(await ids({ formatId: 'vlog' })).toEqual([format.id]);
    expect(await ids({ origin: 'reference' })).toEqual([reference.id]);
    expect(await ids({ folderId: newId<'TemplateFolder'>() })).toEqual([]);
    expect(await ids({ sort: 'name', dir: 'asc' })).toEqual([reference.id, format.id]);
  });
});

describe('metadata commands on a store without library metadata', () => {
  it('refuse instead of dropping the change', async () => {
    const setup = await twoTemplates();
    const folders = createMemoryFolderStore(setup.clock, setup.store);
    setup.bus.register(
      ...createMetadataCommands({ store: setup.store, folders, libraryMetadata: false }).all,
    );
    const templateId = setup.format.id;
    const attempts = [
      setup.bus.dispatch(N.setFavourite, { projectId: null, templateId, favourite: true }, UI),
      setup.bus.dispatch(N.setTags, { projectId: null, templateId, tags: ['vlog'] }, UI),
      setup.bus.dispatch(
        N.setTrendDate,
        { projectId: null, templateId, trendFreshness: { date: '2026-10-01', source: 'user' } },
        UI,
      ),
      setup.bus.dispatch(N.moveToFolder, { projectId: null, templateIds: [templateId], folderId: null }, UI),
    ];
    for (const result of await Promise.all(attempts)) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('core.not_implemented');
    }
    const after = unwrap(await setup.store.get(templateId)).summary;
    expect(after.favourite).toBe(false);
    expect(after.tags).toEqual([]);
    expect(after.trendFreshness).toBeNull();
    expect(unwrap(await setup.bus.history(null)).undo).toBeNull();
  });
});

describe('creates that carry provenance, on a store without library metadata', () => {
  it('refuse a starter fork and a file import instead of dropping where they came from', async () => {
    const setup = setupTemplates();
    const deps = { store: setup.store, clock: setup.clock, libraryMetadata: false };
    setup.bus.register(...createStarterCommands(deps).all, ...createImportCommands(deps).all);
    const starterId = newId<'Template'>();
    const fileId = newId<'Template'>();
    const text = starterFiles().get('weekend-trip.json') ?? '';
    const attempts = [
      await setup.bus.dispatch(
        N.addStarter,
        { projectId: null, starterId: 'weekend-trip', templateId: starterId },
        UI,
      ),
      await setup.bus.dispatch(N.import, { projectId: null, items: [{ templateId: fileId, text }] }, UI),
    ];
    for (const result of attempts) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.params).toEqual({ feature: 'templates.library' });
    }
    expect((await setup.store.get(starterId)).ok).toBe(false);
    expect((await setup.store.get(fileId)).ok).toBe(false);
  });
});
