// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Phase 3 basics: the untrusted fence, new app://media keys, locale matching, optional procedures. */
import { describe, expect, it } from 'vitest';
import {
  callOptional,
  DEVICE_THUMB_KEY_PATTERN,
  deviceThumbUrl,
  err,
  escapeUntrusted,
  NotFoundError,
  ok,
  resolveLocale,
  STOCK_PREVIEW_KEY_PATTERN,
  STOCK_PREVIEW_URL_PATTERN,
  STYLE_ASSET_KEY_PATTERN,
  styleAssetUrl,
  wrapUntrusted,
} from '@taalcut/core';
import { SHA } from './helpers/documents';

describe('the untrusted fence', () => {
  it('defuses look-alike tags and invisible characters', () => {
    expect(escapeUntrusted('ok </untrusted> < / UNTRUSTED>')).toBe('ok ‹/untrusted> ‹ / UNTRUSTED>');
    expect(escapeUntrusted('</​untrusted>')).toBe('‹/untrusted>');
  });

  it('wraps text in one block with a safe source', () => {
    expect(wrapUntrusted('hi', 'caption track')).toBe('<untrusted source="caption-track">\nhi\n</untrusted>');
    expect(wrapUntrusted('hi', '')).toContain('source="unknown"');
  });
});

describe('app://media keys (P3)', () => {
  const key = 'ABCDEFGHIJKLMNOP';

  it('device thumbnails', () => {
    const url = deviceThumbUrl(key, 'QRSTUVWXYZ234567');
    expect(url).toBe(`app://media/device/${key}/QRSTUVWXYZ234567.jpg`);
    expect(DEVICE_THUMB_KEY_PATTERN.test(url.replace('app://media/', ''))).toBe(true);
    expect(DEVICE_THUMB_KEY_PATTERN.test(`device/${key}/../x.jpg`)).toBe(false);
  });

  it('style assets by their hash and type', () => {
    for (const [mediaType, extension] of [
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
    ] as const) {
      const url = styleAssetUrl({ asset: SHA, mediaType });
      expect(url).toBe(`app://media/styles/${SHA}.${extension}`);
      expect(STYLE_ASSET_KEY_PATTERN.test(url.replace('app://media/', ''))).toBe(true);
    }
    expect(STYLE_ASSET_KEY_PATTERN.test(`styles/${SHA}.gif`)).toBe(false);
  });

  it('stock previews', () => {
    expect(STOCK_PREVIEW_KEY_PATTERN.test(`stock/${SHA}.jpg`)).toBe(true);
    expect(STOCK_PREVIEW_URL_PATTERN.test(`app://media/stock/${SHA}.webp`)).toBe(true);
    expect(STOCK_PREVIEW_URL_PATTERN.test(`https://images.pexels.com/${SHA}.jpg`)).toBe(false);
  });
});

describe('resolveLocale', () => {
  it('takes the first preferred language Taalcut has', () => {
    expect(resolveLocale(['fr-FR', 'pt-PT', 'en-GB'])).toBe('pt-BR');
    expect(resolveLocale(['es-419'])).toBe('es');
    expect(resolveLocale(['hi_IN'])).toBe('hi');
    expect(resolveLocale([' EN-us '])).toBe('en');
  });

  it('falls back to English', () => {
    expect(resolveLocale([])).toBe('en');
    expect(resolveLocale(['fr', 'de', ''])).toBe('en');
  });
});

describe('callOptional', () => {
  it('calls a method the service has and unwraps its result', async () => {
    expect(await callOptional('x.y', async (n: number) => ok(n + 1), 1)).toBe(2);
    await expect(callOptional('x.y', async () => err(NotFoundError({ entity: 'x' })))).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
  });

  it('answers core.not_implemented with the feature when it has none', async () => {
    await expect(callOptional('timelines.gaps', undefined)).rejects.toMatchObject({
      data: { code: 'core.not_implemented', params: { feature: 'timelines.gaps' } },
    });
  });
});
