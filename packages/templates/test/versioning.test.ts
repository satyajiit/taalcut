// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-T8: save, version, reopen, edit and reuse across projects, list and search, asset cleanup. */
import { describe, expect, it } from 'vitest';
import { FORMAT_IDS, TEMPLATE_COMMANDS as N, templateListQuerySchema, templatesRouter } from '@taalcut/core';
import { ORPHAN_ASSET_MS } from '../src/test-support';
import { referenceTemplate } from './helpers/fixtures';
import { setupTemplates, UI } from './helpers/setup';

const query = (input: Record<string, unknown> = {}) => templateListQuerySchema.parse(input);

describe('template store and versions', () => {
  it('a template saved in project A is reused in project B; editing makes version 2 and version 1 still opens', async () => {
    const { bus, service, projectA, projectB } = setupTemplates();
    const template = referenceTemplate();
    await bus.dispatch(N.create, { projectId: projectA, template, name: 'Goa reel', listed: true }, UI);

    // Project B finds it in /templates (listed templates show from every project).
    const listed = await service.list(query());
    expect(listed.ok && listed.value.items.map((item) => item.id)).toEqual([template.id]);
    // A timeline in project B is cast from version 1 and keeps pointing at it.
    const timelineRef = { templateId: template.id, version: 1 };

    const edited = await bus.dispatch(
      N.renameSlot,
      {
        projectId: projectB,
        templateId: template.id,
        baseVersion: 1,
        slotId: template.slots[0]!.id,
        name: 'Intro',
      },
      UI,
    );
    expect(edited.ok && edited.value.result).toEqual({ templateId: template.id, version: 2 });
    const head = await service.get({ templateId: template.id });
    expect(head.ok && head.value.template.slots[0]!.name).toBe('Intro');
    expect(head.ok && head.value.summary.head).toBe(2);
    const old = await service.get(timelineRef);
    expect(old.ok && old.value.template.version).toBe(1);
    expect(old.ok && old.value.template.slots[0]!.name).toBe('Hook');
  });

  it('searches by name, slot intent and overlay text, newest first; unlisted and archived only when asked', async () => {
    const { bus, clock, service, projectA } = setupTemplates();
    const goa = referenceTemplate();
    const city = referenceTemplate();
    city.slots[2]!.intent = { ...city.slots[2]!.intent, text: 'night market crowd' };
    await bus.dispatch(N.create, { projectId: projectA, template: goa, name: 'Goa reel', listed: true }, UI);
    clock.advance(1000);
    await bus.dispatch(N.create, { projectId: projectA, template: city, name: 'City', listed: false }, UI);
    const ids = async (input: Record<string, unknown>) => {
      const page = await service.list(query(input));
      return page.ok ? page.value.items.map((item) => item.id) : [];
    };
    expect(await ids({ query: 'goa' })).toEqual([goa.id]);
    expect(await ids({ query: 'market', includeUnlisted: true })).toEqual([city.id]);
    expect(await ids({ query: 'market' })).toEqual([]);
    expect(await ids({ query: 'follow for more', includeUnlisted: true })).toEqual([city.id, goa.id]);
    expect(
      await ids({
        fingerprint: goa.origin.kind === 'reference' ? goa.origin.fingerprint : '',
        includeUnlisted: true,
      }),
    ).toHaveLength(2);
    expect(await ids({ limit: 1, includeUnlisted: true })).toEqual([city.id]);
    await bus.dispatch(N.archive, { projectId: projectA, templateId: goa.id, archived: true }, UI);
    expect(await ids({})).toEqual([]);
    expect(await ids({ includeArchived: true })).toEqual([goa.id]);
  });

  it('serves the read-only IPC router from the service, documents migrated', async () => {
    const { bus, service, projectA } = setupTemplates();
    const template = referenceTemplate();
    await bus.dispatch(N.create, { projectId: projectA, template, name: 'Goa reel', listed: true }, UI);
    expect(Object.keys(templatesRouter(service)).sort()).toEqual([
      'exportDocument',
      'fetchMedia',
      'folders',
      'formats',
      'get',
      'instagramCollections',
      'instagramReels',
      'instagramStatus',
      'list',
      'proposeEdits',
      'search',
      'starters',
      'styleProfile',
      'versions',
      'writeStyleSummary',
    ]);
    const formats = await service.formats();
    expect(formats.ok && formats.value.map((format) => format.id)).toEqual([...FORMAT_IDS]);
    const versions = await service.versions(template.id);
    expect(versions.ok && versions.value).toHaveLength(1);
  });

  it('refuses a stored document newer than this build', async () => {
    const { store, service, projectA } = setupTemplates();
    const template = referenceTemplate();
    await store.create(template, { name: 'x', projectId: projectA, listed: true });
    const raw = await store.get(template.id);
    // A later build wrote version 2 in a shape this one doesn't know.
    const original = store.get.bind(store);
    store.get = async (id, version) => {
      const got = await original(id, version);
      return got.ok ? { ok: true, value: { ...got.value, schemaVersion: 2 } } : got;
    };
    expect(raw.ok).toBe(true);
    const read = await service.get({ templateId: template.id });
    expect(!read.ok && read.error).toMatchObject({
      code: 'templates.unsupported_schema',
      params: { schemaVersion: 2 },
    });
  });

  it('removes contact sheets no version refers to after seven days, never a used one', async () => {
    const { store, clock, projectA } = setupTemplates();
    const orphan = await store.putAsset(new Uint8Array([1, 2, 3]), 'image/jpeg');
    const template = referenceTemplate();
    const sheet = await store.putAsset(new Uint8Array([9, 9]), 'image/jpeg');
    if (!sheet.ok || !orphan.ok) throw new Error('asset');
    template.contactSheet = { ...template.contactSheet!, asset: sheet.value.sha256 };
    await store.create(template, { name: 'x', projectId: projectA, listed: true });
    expect(store.pruneAssets()).toEqual([]);
    clock.advance(ORPHAN_ASSET_MS);
    expect(store.pruneAssets()).toEqual([orphan.value.sha256]);
    expect((await store.assetPath(sheet.value.sha256)).ok).toBe(true);
    await store.remove(template.id);
    expect((await store.assetPath(sheet.value.sha256)).ok).toBe(false);
  });
});
