// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Library metadata, import and export (P3-V14). */
import { describe, expect, it } from 'vitest';
import {
  hubTemplateV0Schema,
  newId,
  ok,
  parseId,
  TEMPLATE_COMMANDS,
  templateListQuerySchema,
} from '@taalcut/core';
import { isStale, trendFreshnessOf } from '../../src/library/freshness';
import { createFolderCommands } from '../../src/library/folder-commands';
import { createImportCommands } from '../../src/library/import-commands';
import { createMetadataCommands } from '../../src/library/metadata-commands';
import { normaliseTag } from '../../src/library/tags';
import { withLibraryReads } from '../../src/library/with-library-reads';
import { asTemplate } from '../../src/testing/memory-template-record';
import { createMemoryFolderStore } from '../../src/testing/memory-folder-store';
import { createMemoryStyleStore } from '../../src/testing/memory-style-store';
import { requirePlan } from '../formats/helpers';
import { referenceTemplate } from '../helpers/fixtures';
import { readField, unwrap } from '../helpers/result';
import { setupTemplates, UI } from '../helpers/setup';

const N = TEMPLATE_COMMANDS;

function library() {
  const setup = setupTemplates({ libraryMetadata: true });
  const folders = createMemoryFolderStore(setup.clock, setup.store);
  const styles = createMemoryStyleStore();
  setup.bus.register(...createMetadataCommands({ store: setup.store, folders, libraryMetadata: true }).all);
  setup.bus.register(...createFolderCommands({ folders }).all);
  setup.bus.register(...createImportCommands({ store: setup.store, clock: setup.clock, libraryMetadata: true }).all);
  const hubId = parseId<'HubTemplate'>('01HZZZZZZZZZZZZZZZ00000000');
  if (!hubId.ok) throw new Error(hubId.error.code);
  const service = withLibraryReads(setup.service, {
    folders,
    starters: { starters: () => Promise.resolve(ok([])) },
    files: { store: setup.store, styles, ids: { hub: () => hubId.value } },
  });
  return { ...setup, folders, service };
}

async function storedTemplate() {
  const setup = library();
  const template = referenceTemplate();
  const created = await setup.bus.dispatch(
    N.create,
    { projectId: setup.projectA, template, name: 'Goa reel', listed: true },
    UI,
  );
  expect(created.ok).toBe(true);
  return { ...setup, template };
}

describe('template metadata commands', () => {
  it('normalises tags, including Devanagari, and undoes', async () => {
    expect(unwrap(normaliseTag('  Road  Trip '))).toBe('road-trip');
    expect(unwrap(normaliseTag('शादी'))).toBe('शादी');
    const invalid = normaliseTag('!!!');
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('templates.tag_invalid');

    const { bus, store, template } = await storedTemplate();
    const tagged = await bus.dispatch(
      N.setTags,
      { projectId: null, templateId: template.id, tags: ['शादी', '  Road  Trip ', 'शादी'] },
      UI,
    );
    expect(tagged.ok ? readField(tagged.value.result, 'tags') : []).toEqual(['शादी', 'road-trip']);
    const tooMany = await bus.dispatch(
      N.setTags,
      {
        projectId: null,
        templateId: template.id,
        tags: Array.from({ length: 13 }, (_, index) => `tag-${index}`),
      },
      UI,
    );
    expect(tooMany.ok).toBe(false);
    expect((await bus.undo(null, UI)).ok).toBe(true);
    const summary = await store.get(template.id);
    expect(summary.ok && summary.value.summary.tags).toEqual([]);
    expect((await bus.redo(null, UI)).ok).toBe(true);
    const again = await store.get(template.id);
    expect(again.ok && again.value.summary.tags).toEqual(['शादी', 'road-trip']);
  });

  it('stars and dates a template, and one undo puts both back', async () => {
    const { bus, store, template } = await storedTemplate();
    expect(
      (await bus.dispatch(N.setFavourite, { projectId: null, templateId: template.id, favourite: true }, UI))
        .ok,
    ).toBe(true);
    const dated = await bus.dispatch(
      N.setTrendDate,
      { projectId: null, templateId: template.id, trendFreshness: { date: '2024-01-02', source: 'user' } },
      UI,
    );
    expect(dated.ok).toBe(true);
    expect((await bus.undo(null, UI)).ok).toBe(true);
    expect((await bus.undo(null, UI)).ok).toBe(true);
    const summary = await store.get(template.id);
    expect(summary.ok && summary.value.summary.favourite).toBe(false);
    expect(summary.ok && summary.value.summary.trendFreshness).toBeNull();
    expect((await bus.redo(null, UI)).ok).toBe(true);
    expect((await bus.redo(null, UI)).ok).toBe(true);
    const again = await store.get(template.id);
    expect(again.ok && again.value.summary.favourite).toBe(true);
    expect(again.ok && again.value.summary.trendFreshness).toEqual({ date: '2024-01-02', source: 'user' });
  });

  it('moves several templates in one undo, and a missing folder writes nothing', async () => {
    const { bus, store, folders, template, projectA } = await storedTemplate();
    const other = referenceTemplate();
    expect(
      (
        await bus.dispatch(
          N.create,
          { projectId: projectA, template: other, name: 'Other', listed: true },
          UI,
        )
      ).ok,
    ).toBe(true);
    const folderId = newId<'TemplateFolder'>();
    expect(
      (await bus.dispatch('templateFolder.create', { projectId: null, folderId, name: 'Trips' }, UI)).ok,
    ).toBe(true);
    const missing = await bus.dispatch(
      N.moveToFolder,
      { projectId: null, templateIds: [template.id], folderId: newId<'TemplateFolder'>() },
      UI,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('templates.folder_not_found');
    const partial = await bus.dispatch(
      N.moveToFolder,
      { projectId: null, templateIds: [template.id, newId<'Template'>()], folderId },
      UI,
    );
    expect(partial.ok).toBe(false);
    expect(unwrap(await store.get(template.id)).summary.folderId).toBeNull();

    const moved = await bus.dispatch(
      N.moveToFolder,
      { projectId: null, templateIds: [template.id, other.id, template.id], folderId },
      UI,
    );
    expect(moved.ok ? readField(moved.value.result, 'templateIds') : []).toEqual([template.id, other.id]);
    expect((await bus.undo(null, UI)).ok).toBe(true);
    expect(unwrap(await store.get(template.id)).summary.folderId).toBeNull();
    expect(unwrap(await store.get(other.id)).summary.folderId).toBeNull();
    expect((await bus.redo(null, UI)).ok).toBe(true);
    expect(unwrap(await store.get(other.id)).summary.folderId).toBe(folderId);
    const listed = await folders.list();
    expect(listed.ok && listed.value[0]?.templates).toBe(2);
  });

  it('imports all or nothing, undoes both, and round-trips structure through a file', async () => {
    const { bus, store, service, clock } = await storedTemplate();
    const planned = requirePlan('talkingHead', 30);
    expect(
      (
        await bus.dispatch(
          N.create,
          { projectId: null, template: planned, name: 'Talking head', listed: true },
          UI,
        )
      ).ok,
    ).toBe(true);
    const exported = await service.exportDocument({ templateId: planned.id, includeStyle: false });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value.fileName).toBe('talking-head.taalcut-template');
    const raw: unknown = JSON.parse(exported.value.text);
    const doc = hubTemplateV0Schema.parse(raw);

    const first = newId<'Template'>();
    const second = newId<'Template'>();
    const imported = await bus.dispatch(
      N.import,
      {
        projectId: null,
        items: [
          { templateId: first, text: exported.value.text },
          { templateId: second, text: exported.value.text },
        ],
      },
      UI,
    );
    expect(imported.ok ? readField(imported.value.result, 'templateIds') : []).toEqual([first, second]);
    const copy = await store.get(first);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.value.summary.provenance).toEqual({ kind: 'file', importedAt: clock.now(), hubId: doc.id });
    const forked = asTemplate(copy.value.json);
    expect(forked.slots.map((slot) => [slot.role, slot.start.value, slot.duration.value])).toEqual(
      planned.slots.map((slot) => [slot.role, slot.start.value, slot.duration.value]),
    );
    expect(forked.text.map((item) => item.text)).toEqual(doc.structure.text.map((item) => item.placeholder));
    expect((await bus.undo(null, UI)).ok).toBe(true);
    expect((await store.get(first)).ok).toBe(false);
    expect((await store.get(second)).ok).toBe(false);

    const kept = newId<'Template'>();
    const refused = await bus.dispatch(
      N.import,
      {
        projectId: null,
        items: [
          { templateId: kept, text: exported.value.text },
          { templateId: newId(), text: '{}' },
        ],
      },
      UI,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('templates.import_invalid');
      expect(refused.error.params?.file).toBe(1);
    }
    expect((await store.get(kept)).ok).toBe(false);
    const found = await store.list(
      templateListQuerySchema.parse({ query: 'शादी', includeUnlisted: true, limit: 10 }),
    );
    expect(found.ok).toBe(true);
  });

  it('treats a trend as stale only once it is strictly older than the window', () => {
    expect(trendFreshnessOf(null, 'user')).toBeNull();
    expect(trendFreshnessOf('2024-01-02', 'hub')).toEqual({ date: '2024-01-02', source: 'hub' });
    const start = Date.parse('2020-01-01T00:00:00.000Z');
    const day = 86_400_000;
    expect(isStale('2020-01-01', start + 90 * day, 90)).toBe(false);
    expect(isStale('2020-01-01', start + 90 * day + 1, 90)).toBe(true);
  });
});
