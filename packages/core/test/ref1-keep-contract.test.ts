// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** REF1-KEEP's contract: a template's kept media, the summary that carries it, and templates.fetchMedia. */
import { describe, expect, it } from 'vitest';
import {
  connectRpc,
  defineError,
  err,
  NO_TEMPLATE_LIBRARY_META,
  ok,
  REFERENCE_DOWNLOAD_WARNING,
  serveRpc,
  TEMPLATE_MEDIA_SOURCES,
  templateMediaSchema,
  templatesContract,
  templatesRouter,
  templateSummaryFacts,
  templateSummarySchema,
  TemplateMediaStoreToken,
  type TemplateMedia,
  type TemplateSummary,
  type TemplatesService,
} from '@taalcut/core';
import { at, json, referenceTemplate, T0 } from './helpers/documents';
import { channel } from './helpers/ports';

/** @taalcut/templates declares it; the contract names it as the fetch's error for a template with no link. */
const NoOriginLink = defineError('templates.no_origin_link');
const template = referenceTemplate();
const media: TemplateMedia = {
  file: 'reference.mp4',
  bytes: 4_200_000,
  durationMs: 15_000,
  sha256: 'a'.repeat(64),
  hasAudio: true,
  source: 'anonymous',
  keptAt: T0,
};
const summary: TemplateSummary = {
  id: template.id,
  name: 'Goa reel',
  head: 1,
  origin: 'reference',
  platform: 'reels',
  duration: at(90),
  slotCount: 3,
  bpm: 120,
  projectId: null,
  listed: true,
  archived: false,
  ...templateSummaryFacts(template),
  ...NO_TEMPLATE_LIBRARY_META,
  createdAt: T0,
  updatedAt: T0,
};

const base: TemplatesService = {
  list: async () => ok({ items: [], nextCursor: null }),
  get: async () => ok({ summary, template }),
  versions: async () => ok([]),
  formats: async () => ok([]),
};

function serve(service: TemplatesService) {
  const { port1, port2 } = channel();
  serveRpc(templatesRouter(service), port1, { context: {} });
  return connectRpc(templatesContract, port2, { peer: 'agent' }).client;
}

describe('REF1-KEEP contract', () => {
  it('describes kept media by its file, size, length, hash, sound and source', () => {
    expect(TEMPLATE_MEDIA_SOURCES).toEqual(['anonymous', 'session', 'file']);
    expect(templateMediaSchema.parse(media)).toEqual(media);
    for (const file of ['../reference.mp4', 'Reference.mp4', '.mp4', 'a/b.mp4', 'x'.repeat(65)])
      expect(templateMediaSchema.safeParse({ ...media, file }).success).toBe(false);
    expect(templateMediaSchema.safeParse({ ...media, bytes: 0 }).success).toBe(false);
    expect(templateMediaSchema.safeParse({ ...media, durationMs: 0 }).success).toBe(false);
    expect(templateMediaSchema.safeParse({ ...media, source: 'cookies' }).success).toBe(false);
    expect(templateMediaSchema.safeParse({ ...media, sha256: 'A'.repeat(64) }).success).toBe(false);
  });

  it('reads a summary from before REF1, one without media and one with it', () => {
    expect(templateSummarySchema.parse(json(summary)).media).toBeUndefined();
    expect(templateSummarySchema.parse({ ...(json(summary) as object), media: null }).media).toBeNull();
    expect(templateSummarySchema.parse({ ...(json(summary) as object), media }).media).toEqual(media);
  });

  it('serves templates.fetchMedia, and answers not_implemented while the service has none', async () => {
    const asked: unknown[] = [];
    const client = serve({
      ...base,
      fetchMedia: async (input) =>
        input.id === template.id ? (asked.push(input), ok({ ...summary, media })) : err(NoOriginLink()),
    });
    expect((await client.fetchMedia({ id: template.id })).media).toEqual(media);
    expect(asked).toEqual([{ id: template.id }]);
    await expect(client.fetchMedia({ id: template.slots[0]!.id as never })).rejects.toMatchObject({
      data: { code: 'templates.no_origin_link' },
    });
    await expect(serve(base).fetchMedia({ id: template.id })).rejects.toMatchObject({
      data: { code: 'core.not_implemented', params: { feature: 'templates.fetchMedia' } },
    });
  });

  it('keeps the old warning constant and names the media store', () => {
    expect(REFERENCE_DOWNLOAD_WARNING).toEqual({
      featureId: 'reference.download',
      termsVersion: '2026-10-01',
    });
    expect(TemplateMediaStoreToken.key).toBe('core.templateMediaStore');
  });
});
