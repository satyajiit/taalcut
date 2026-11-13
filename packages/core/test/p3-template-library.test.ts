// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Templates as a library: eight formats, tags, folders, trend dates, provenance, starters (P3-V1, P3-V14, P3-B3). */
import { describe, expect, it } from 'vitest';
import {
  err,
  FORMAT_IDS,
  formatSummarySchema,
  newId,
  NO_TEMPLATE_LIBRARY_META,
  NotFoundError,
  ok,
  STALE_AFTER_DAYS_SETTING,
  starterSummarySchema,
  TEMPLATE_COMMANDS,
  TEMPLATE_FOLDER_COMMANDS,
  templateCommandPayloads,
  templateFolderCommandPayloads,
  templateFolderSchema,
  templateListQuerySchema,
  templateProvenanceSchema,
  templateSchema,
  templatesContract,
  templatesRouter,
  templateSummaryFacts,
  templateSummarySchema,
  templateTagSchema,
  trendFreshnessSchema,
  type TemplatesService,
} from '@taalcut/core';
import { formatTemplate, json, referenceTemplate, SHA, T0 } from './helpers/documents';
import { hubTemplate, serve } from './helpers/phase3';

const templateId = newId<'Template'>();
const folderId = newId<'TemplateFolder'>();

describe('formats', () => {
  it('are eight, and a Template v1 of a new format parses', () => {
    expect(FORMAT_IDS).toHaveLength(8);
    const base = formatTemplate();
    if (base.origin.kind !== 'format') throw new Error('a format template');
    const doc = { ...base, origin: { ...base.origin, formatId: 'tutorial' } };
    expect(templateSchema.safeParse(json(doc)).success).toBe(true);
  });

  it('say their default tempo, sound and captions', () => {
    const summary = {
      id: 'podcastClip',
      version: '1',
      nameKey: 'formats.podcastClip.name',
      descriptionKey: 'formats.podcastClip.description',
      minSeconds: 15,
      maxSeconds: 90,
      defaultBpm: 100,
      audio: 'voice',
      captions: 'required',
    };
    expect(formatSummarySchema.safeParse(summary).success).toBe(true);
    expect(formatSummarySchema.safeParse({ ...summary, defaultBpm: 200, audio: 'both' }).success).toBe(false);
  });
});

describe('library metadata', () => {
  it('tags are NFC, lower case and hyphenated, in any script', () => {
    expect(templateTagSchema.parse('  Road  Trip ')).toBe('road-trip');
    expect(templateTagSchema.parse('यात्रा')).toBe('यात्रा');
    expect(templateTagSchema.parse('Café')).toBe('café');
    expect(templateTagSchema.safeParse('#trip').success).toBe(false);
    expect(templateTagSchema.safeParse('').success).toBe(false);
    expect(templateTagSchema.safeParse('a'.repeat(33)).success).toBe(false);
  });

  it('trend dates name their source, and go stale after a setting', () => {
    expect(trendFreshnessSchema.safeParse({ date: '2026-10-01', source: 'hub' }).success).toBe(true);
    expect(trendFreshnessSchema.safeParse({ date: '2026-13-01', source: 'hub' }).success).toBe(false);
    expect(trendFreshnessSchema.safeParse({ date: '2026-10-01', source: 'tiktok' }).success).toBe(false);
    expect(STALE_AFTER_DAYS_SETTING).toMatchObject({ key: 'templates.staleAfterDays', defaultValue: 90 });
    expect(STALE_AFTER_DAYS_SETTING.schema.safeParse(3).success).toBe(false);
  });

  it('provenance is a hub fork, a file or a starter', () => {
    const hub = {
      kind: 'hub',
      hubId: newId<'HubTemplate'>(),
      version: 2,
      handle: 'kaatu.cuts',
      licence: 'CC0-1.0',
      forkedAt: T0,
    };
    expect(templateProvenanceSchema.parse(hub)).toMatchObject({ removed: false });
    expect(templateProvenanceSchema.safeParse({ kind: 'file', importedAt: T0, hubId: null }).success).toBe(
      true,
    );
    expect(
      templateProvenanceSchema.safeParse({ kind: 'starter', starterId: 'weekend-trip', locale: 'hi' })
        .success,
    ).toBe(true);
    expect(
      templateProvenanceSchema.safeParse({ kind: 'starter', starterId: 'Weekend', locale: 'fr' }).success,
    ).toBe(false);
  });

  it('summaries carry the head facts and the metadata', () => {
    const template = referenceTemplate();
    const summary = {
      id: template.id,
      name: 'Goa',
      head: 1,
      origin: 'reference',
      platform: 'reels',
      duration: template.duration,
      slotCount: 3,
      bpm: 120,
      projectId: null,
      listed: true,
      archived: false,
      ...templateSummaryFacts({ ...template, styleId: newId<'Style'>() }),
      ...NO_TEMPLATE_LIBRARY_META,
      createdAt: T0,
      updatedAt: T0,
    };
    expect(templateSummarySchema.safeParse(json(summary)).success).toBe(true);
    expect(templateSummaryFacts(formatTemplate())).toMatchObject({
      formatId: 'vlog',
      slotStrip: [30, 30, 30],
    });
    expect(templateSummaryFacts({})).toMatchObject({
      slotStrip: [],
      formatId: null,
      language: null,
      styleId: null,
    });
    expect(templateSummarySchema.safeParse({ ...summary, tags: ['Not OK!'] }).success).toBe(false);
  });

  it('lists filter by tag, folder, favourite, format, language, origin and staleness', () => {
    const query = templateListQuerySchema.parse({
      tags: ['Road Trip'],
      folderId: 'none',
      favourite: true,
      formatId: 'ugcAd',
      language: 'pt-BR',
      origin: 'reference',
      stale: false,
      sort: 'trend',
      dir: 'asc',
    });
    expect(query).toMatchObject({ tags: ['road-trip'], folderId: 'none', sort: 'trend', limit: 50 });
    expect(templateListQuerySchema.parse({ folderId })).toMatchObject({ folderId });
    expect(templateListQuerySchema.safeParse({ sort: 'popular' }).success).toBe(false);
    expect(templateListQuerySchema.parse({})).not.toHaveProperty('sort');
  });

  it('a folder has a name and a count', () => {
    expect(
      templateFolderSchema.safeParse({ id: folderId, name: 'Clients', templates: 3, createdAt: T0 }).success,
    ).toBe(true);
    expect(
      templateFolderSchema.safeParse({ id: folderId, name: '', templates: -1, createdAt: T0 }).success,
    ).toBe(false);
  });
});

describe('template commands (P3)', () => {
  const p = templateCommandPayloads;

  it('library metadata is app-wide', () => {
    expect(p[TEMPLATE_COMMANDS.setTags].parse({ templateId, tags: ['Goa Trip'] })).toEqual({
      projectId: null,
      templateId,
      tags: ['goa-trip'],
    });
    expect(p[TEMPLATE_COMMANDS.setTags].safeParse({ templateId, tags: Array(13).fill('a') }).success).toBe(
      false,
    );
    expect(p[TEMPLATE_COMMANDS.setFavourite].safeParse({ templateId, favourite: true }).success).toBe(true);
    expect(p[TEMPLATE_COMMANDS.setTrendDate].safeParse({ templateId, trendFreshness: null }).success).toBe(
      true,
    );
    const move = p[TEMPLATE_COMMANDS.moveToFolder];
    expect(move.safeParse({ templateIds: [templateId], folderId: null }).success).toBe(true);
    expect(move.safeParse({ templateIds: [], folderId }).success).toBe(false);
    const restore = p[TEMPLATE_COMMANDS.restoreFolders];
    expect(restore.safeParse({ moves: [{ templateId, folderId }] }).success).toBe(true);
  });

  it('imports files, adds starters, sets a style and an energy curve', () => {
    const text = JSON.stringify(hubTemplate());
    expect(p[TEMPLATE_COMMANDS.import].safeParse({ items: [{ templateId, text }] }).success).toBe(true);
    expect(p[TEMPLATE_COMMANDS.import].safeParse({ items: [] }).success).toBe(false);
    expect(p[TEMPLATE_COMMANDS.discardMany].safeParse({ templateIds: [templateId] }).success).toBe(true);
    const starter = p[TEMPLATE_COMMANDS.addStarter];
    expect(starter.safeParse({ starterId: 'weekend-trip', templateId }).success).toBe(true);
    expect(starter.safeParse({ starterId: 'Weekend Trip', templateId }).success).toBe(false);
    const projectId = newId<'Project'>();
    const edit = { projectId, templateId, baseVersion: 1 };
    expect(p[TEMPLATE_COMMANDS.setStyle].safeParse({ ...edit, styleId: null }).success).toBe(true);
    const slot = newId<'TemplateSlot'>();
    const curve = {
      sections: [{ fromSlotId: slot, toSlotId: slot, energy: 0.8, beatsPerClip: 0.5, align: 'beat' }],
    };
    expect(p[TEMPLATE_COMMANDS.setEnergyCurve].safeParse({ ...edit, curve }).success).toBe(true);
  });

  it('folders are created, renamed, deleted and restored', () => {
    const f = templateFolderCommandPayloads;
    expect(f[TEMPLATE_FOLDER_COMMANDS.create].parse({ folderId, name: ' Clients ' })).toMatchObject({
      name: 'Clients',
      projectId: null,
    });
    expect(f[TEMPLATE_FOLDER_COMMANDS.rename].safeParse({ folderId, name: '' }).success).toBe(false);
    expect(f[TEMPLATE_FOLDER_COMMANDS.remove].safeParse({ folderId }).success).toBe(true);
    const folder = { id: folderId, name: 'Clients', createdAt: T0 };
    expect(f[TEMPLATE_FOLDER_COMMANDS.restore].safeParse({ folder, templateIds: [templateId] }).success).toBe(
      true,
    );
    expect(TEMPLATE_FOLDER_COMMANDS.remove).toBe('templateFolder.delete');
  });
});

describe('starters and the templates namespace', () => {
  const starter = {
    starterId: 'weekend-trip',
    nameKey: 'starters.weekend-trip.name',
    formatId: 'vlog',
    needs: 'many-clips',
    structure: hubTemplate().structure,
  };

  it('a starter is a structure with a need', () => {
    expect(starterSummarySchema.safeParse(starter).success).toBe(true);
    expect(starterSummarySchema.safeParse({ ...starter, needs: 'drone' }).success).toBe(false);
  });

  const base: TemplatesService = {
    list: async () => ok({ items: [], nextCursor: null }),
    get: async () => err(NotFoundError({ entity: 'template' })),
    versions: async () => ok([]),
    formats: async () => ok([]),
  };

  it("answers core.not_implemented for P3 reads the service doesn't have yet", async () => {
    const client = serve(templatesContract, templatesRouter(base));
    for (const call of [
      () => client.folders(),
      () => client.starters({ locale: 'en' }),
      () => client.exportDocument({ templateId }),
    ])
      await expect(call()).rejects.toMatchObject({ data: { code: 'core.not_implemented' } });
  });

  it('serves folders, starters and a template as a file when it has them', async () => {
    const asked: unknown[] = [];
    const client = serve(
      templatesContract,
      templatesRouter({
        ...base,
        folders: async () => ok([{ id: folderId, name: 'Clients', templates: 0, createdAt: T0 }]),
        starters: async (input) => (asked.push(input), ok([starterSummarySchema.parse(starter)])),
        exportDocument: async (input) => (
          asked.push(input),
          ok({ fileName: 'Goa.taalcut-template', text: SHA })
        ),
      }),
    );
    expect(await client.folders()).toHaveLength(1);
    expect((await client.starters({ locale: 'pt-BR' }))[0]?.starterId).toBe('weekend-trip');
    expect((await client.exportDocument({ templateId })).fileName).toBe('Goa.taalcut-template');
    expect(asked).toEqual([
      { locale: 'pt-BR', forLibrary: true },
      { templateId, includeStyle: false },
    ]);
  });
});
