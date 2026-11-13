// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Reading template versions for casting: the head or a named version, and every way a stored one can be wrong. */
import { err, NotFoundError, ok, TEMPLATE_SCHEMA_VERSION, TimeoutError, type StoredTemplateVersion, type Template } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { memoryTemplateReader, storeTemplateReader } from '../src/service/templates';
import { buildTemplate } from './fixtures/template';

const template = buildTemplate({ slots: [{ frames: 30 }, { frames: 45 }] });

function stored(json: unknown, schemaVersion = TEMPLATE_SCHEMA_VERSION): StoredTemplateVersion {
  return { summary: {} as StoredTemplateVersion['summary'], version: 1, schemaVersion, json };
}

describe('template readers', () => {
  it('reads a stored version through core\'s schema', async () => {
    const reader = storeTemplateReader({ get: async () => ok(stored(JSON.parse(JSON.stringify(template)))) });
    const read = await reader.read({ id: template.id });
    expect(read.ok && read.value).toEqual(template);
  });

  it('answers a missing template, a newer schema and a broken document as errors', async () => {
    const missing = storeTemplateReader({ get: async () => err(NotFoundError({ entity: 'template', id: template.id })) });
    const gone = await missing.read({ id: template.id });
    expect(!gone.ok && gone.error.code).toBe('timeline.template_not_found');
    const failing = storeTemplateReader({ get: async () => err(TimeoutError({ ms: 5 })) });
    const failed = await failing.read({ id: template.id });
    expect(!failed.ok && failed.error.code).toBe('core.timeout');
    const newer = storeTemplateReader({ get: async () => ok(stored({}, TEMPLATE_SCHEMA_VERSION + 1)) });
    const refused = await newer.read({ id: template.id });
    expect(!refused.ok && refused.error.code).toBe('timeline.unsupported_schema');
    const broken = storeTemplateReader({ get: async () => ok(stored({ id: template.id })) });
    const invalid = await broken.read({ id: template.id });
    expect(!invalid.ok && invalid.error.code).toBe('core.validation');
  });

  it('says whether a template keeps its reel with sound (REF1): the media store first, else the summary', async () => {
    const media = (hasAudio: boolean) =>
      ({ file: 'reference.mp4', bytes: 1, durationMs: 1, sha256: 'a'.repeat(64), hasAudio, source: 'anonymous', keptAt: 0 }) as const;
    const summaryWith = (summaryMedia: unknown) => async () =>
      ok({ ...stored(template), summary: { media: summaryMedia } as unknown as StoredTemplateVersion['summary'] });
    const withSummary = (summaryMedia: unknown) => storeTemplateReader({ get: summaryWith(summaryMedia) });
    expect(await withSummary(media(true)).keptAudio!(template.id)).toEqual(ok(true));
    expect(await withSummary(media(false)).keptAudio!(template.id)).toEqual(ok(false));
    expect(await withSummary(undefined).keptAudio!(template.id)).toEqual(ok(false));
    const gone = storeTemplateReader({ get: async () => err(NotFoundError({ entity: 'template', id: template.id })) });
    expect(await gone.keptAudio!(template.id)).toEqual(ok(false));
    // The media store also knows the file is still there: its answer wins over the summary's.
    const fileGone = storeTemplateReader({ get: summaryWith(media(true)) }, { get: async () => ok(null) });
    expect(await fileGone.keptAudio!(template.id)).toEqual(ok(false));
    const kept = storeTemplateReader({ get: async () => ok(stored(template)) }, {
      get: async () => ok({ media: media(true), path: '/media/reference.mp4' }),
    });
    expect(await kept.keptAudio!(template.id)).toEqual(ok(true));
    expect(await memoryTemplateReader([template], [template.id]).keptAudio!(template.id)).toEqual(ok(true));
    expect(await memoryTemplateReader([template]).keptAudio!(template.id)).toEqual(ok(false));
  });

  it('picks the head, or the version asked for, from memory', async () => {
    const second: Template = { ...template, version: 2 };
    const reader = memoryTemplateReader([template, second]);
    const head = await reader.read({ id: template.id });
    expect(head.ok && head.value.version).toBe(2);
    const first = await reader.read({ id: template.id, version: 1 });
    expect(first.ok && first.value.version).toBe(1);
    const none = await reader.read({ id: template.id, version: 3 });
    expect(!none.ok && none.error.code).toBe('timeline.template_not_found');
  });
});
