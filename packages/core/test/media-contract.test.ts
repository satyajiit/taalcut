// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Media, vision and audio's settings, URLs, event and resource classes (P2-L4 to P2-L9). */
import { describe, expect, it } from 'vitest';
import {
  APP_CSP_DIRECTIVES,
  createMemorySettingsStore,
  err,
  MEDIA_CACHE_CAP_SETTING,
  mediaUrl,
  RESOURCE_CLASSES,
  standingUploadConsent,
  taalcutEventSchema,
  TEMPLATE_ASSET_KEY_PATTERN,
  templateAssetUrl,
  UnknownError,
  UPLOAD_CONSENTS_SETTING,
} from '@taalcut/core';

const HASH = 'c'.repeat(64);

describe('media contract', () => {
  it('runs video-engine and Neural Engine work in their own pools', () => {
    expect(RESOURCE_CLASSES).toEqual(['cpu', 'gpu', 'npu', 'video', 'io', 'network']);
  });

  it('serves derived files and template assets from app://media, which the CSP allows', () => {
    expect(mediaUrl({ key: `proxies/cc/${HASH}.v1.mp4` })).toBe(`app://media/proxies/cc/${HASH}.v1.mp4`);
    const sheet = templateAssetUrl({ asset: HASH, mediaType: 'image/webp' });
    expect(sheet).toBe(`app://media/templates/${HASH}.webp`);
    expect(TEMPLATE_ASSET_KEY_PATTERN.test(sheet.replace('app://media/', ''))).toBe(true);
    expect(templateAssetUrl({ asset: HASH, mediaType: 'image/jpeg' })).toMatch(/\.jpg$/);
    expect(APP_CSP_DIRECTIVES['img-src']).toContain('app://media');
    expect(APP_CSP_DIRECTIVES['media-src']).toContain('app://media');
  });

  it('caps the media cache between 2 GB and 2 TB, 20 GB by default', async () => {
    const settings = createMemorySettingsStore();
    expect(await settings.get(MEDIA_CACHE_CAP_SETTING)).toEqual({ ok: true, value: 20_000_000_000 });
    expect((await settings.set(MEDIA_CACHE_CAP_SETTING, 1_000_000_000)).ok).toBe(false);
  });

  it('a standing upload consent covers only the providers it named', async () => {
    const settings = createMemorySettingsStore();
    expect(await standingUploadConsent(settings, 'vision', ['openai'])).toEqual({ ok: true, value: null });
    await settings.set(UPLOAD_CONSENTS_SETTING, {
      vision: { id: 'c1', module: 'vision', providers: ['openai', 'google'], grantedAt: 1 },
    });
    expect(await standingUploadConsent(settings, 'vision', ['openai'])).toEqual({
      ok: true,
      value: { consentId: 'c1' },
    });
    expect(await standingUploadConsent(settings, 'vision', ['openai', 'anthropic'])).toEqual({
      ok: true,
      value: null,
    });
    expect(await standingUploadConsent(settings, 'speech', [])).toEqual({ ok: true, value: null });
    const broken = { get: async () => err(UnknownError()) };
    expect((await standingUploadConsent(broken, 'vision', [])).ok).toBe(false);
  });

  it('tells the library which derived files were evicted, by key', () => {
    const event = {
      type: 'media.derivedEvicted',
      at: 1,
      payload: { keys: [`stills/cc/${HASH}.v3.jpg`], freedBytes: 9 },
    };
    expect(taalcutEventSchema.parse(event)).toEqual(event);
    expect(
      taalcutEventSchema.safeParse({ ...event, payload: { keys: ['/tmp/x.jpg'], freedBytes: 9 } }).success,
    ).toBe(false);
  });
});
