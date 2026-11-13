// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { classifyLicence } from '../../src/stock/licences';
import { freesoundFilter, freesoundProvider } from '../../src/stock/providers/freesound';
import { choosePexelsRendition, pexelsProvider } from '../../src/stock/providers/pexels';
import { defaultStockProviders } from '../../src/stock/providers';
import { FREESOUND_FIXTURE, fixtureHttp, PEXELS_FIXTURE } from './fixtures';

const signal = new AbortController().signal;
const pexelsVideos = JSON.parse(PEXELS_FIXTURE.toString()) as {
  videos: { video_files: { id: number; width: number; height: number; fps: number; link: string }[] }[];
};

describe('stock providers', () => {
  it('asks Pexels for videos with the raw key and picks the smallest in-range rendition', async () => {
    const http = fixtureHttp([{ prefix: 'https://api.pexels.com/v1/videos/search', body: PEXELS_FIXTURE }]);
    const page = await pexelsProvider.search(
      { query: 'ocean', kind: 'video', orientation: 'portrait', page: 1 },
      { http, credential: 'pexels-user-key', signal, perPage: 15 },
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const url = new URL(http.calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.pexels.com/v1/videos/search');
    expect(url.searchParams.get('query')).toBe('ocean');
    expect(url.searchParams.get('orientation')).toBe('portrait');
    expect(url.searchParams.get('page')).toBe('1');
    expect(Number(url.searchParams.get('per_page'))).toBeLessThanOrEqual(80);
    expect(http.calls[0]?.headers.Authorization).toBe('pexels-user-key');
    expect(http.calls[0]?.headers.Authorization).not.toMatch(/bearer/i);
    const ocean = page.value.hits.find((hit) => hit.providerId === '101');
    const rain = page.value.hits.find((hit) => hit.providerId === '202');
    expect(ocean).toMatchObject({
      provider: 'pexels',
      licence: 'Pexels-Licence',
      rawLicence: 'Pexels-Licence',
      renditionKey: '15',
      downloadUrl: 'https://player.pexels.test/2160.mp4',
      attribution: '',
    });
    expect(rain).toMatchObject({
      renditionKey: '21',
      downloadUrl: 'https://player.pexels.test/portrait.mp4',
    });
    const files = pexelsVideos.videos[0]?.video_files.map((file) => ({ ...file, id: String(file.id) })) ?? [];
    expect(choosePexelsRendition(files, undefined)?.id).toBe('12');
    expect(choosePexelsRendition(files, 'landscape')?.link).toBe('https://player.pexels.test/720.mp4');
  });

  it('prefers 30 fps among equal sizes and refuses anything over 4K or under the floor', () => {
    const link = (id: string) => `https://player.pexels.test/${id}.mp4`;
    const same = [
      { id: 'a', width: 1920, height: 1080, fps: 24, link: link('a') },
      { id: 'b', width: 1920, height: 1080, fps: 30, link: link('b') },
    ];
    expect(choosePexelsRendition(same, 'landscape')?.id).toBe('b');
    const portrait = [
      { id: 'wide', width: 1920, height: 1080, fps: 30, link: link('wide') },
      { id: 'tall', width: 1080, height: 1920, fps: 24, link: link('tall') },
      { id: 'short', width: 720, height: 1280, fps: 30, link: link('short') },
      { id: 'cinema', width: 2160, height: 4096, fps: 30, link: link('cinema') },
    ];
    expect(choosePexelsRendition(portrait, 'portrait')?.id).toBe('tall');
    expect(
      choosePexelsRendition([{ id: 'sd', width: 640, height: 360, fps: 30, link: link('sd') }], undefined),
    ).toBe(null);
  });

  it('asks Freesound with a token, the licence allow-list, and drops NC, Sampling+ and unknown', async () => {
    const http = fixtureHttp([{ prefix: 'https://freesound.org/apiv2/search/', body: FREESOUND_FIXTURE }]);
    const page = await freesoundProvider.search(
      { query: 'rain', kind: 'soundEffect', minSeconds: 0.2, maxSeconds: 30, page: 1 },
      { http, credential: 'freesound-user-token', signal, perPage: 15 },
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const url = new URL(http.calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://freesound.org/apiv2/search/');
    expect(url.searchParams.get('query')).toBe('rain');
    expect(url.searchParams.get('filter')).toBe(freesoundFilter({ minSeconds: 0.2, maxSeconds: 30 }));
    expect(url.searchParams.get('fields')).toBe('id,name,username,license,url,duration,previews,type');
    expect(Number(url.searchParams.get('page_size'))).toBeLessThanOrEqual(150);
    expect(http.calls[0]?.headers.Authorization).toBe('Token freesound-user-token');
    expect(page.value.hits.map((hit) => hit.providerId)).toEqual(['1', '2']);
    expect(page.value.hits[0]).toMatchObject({
      licence: 'CC0-1.0',
      rawLicence: 'Creative Commons 0',
      renditionKey: 'preview-hq-mp3',
      downloadUrl: 'https://freesound.org/data/previews/1_hq.mp3',
      attribution: '',
    });
    expect(page.value.hits[1]?.attribution).toBe(
      '"Bell" by ben (https://freesound.org/s/2/) licensed under CC BY 4.0',
    );
    expect(classifyLicence('freesound', 'Some Other Deed').ok).toBe(false);
  });

  it('keeps only https links from a provider response', async () => {
    const files = (id: number, link: string) => [{ id, width: 1920, height: 1080, fps: 30, link }];
    const body = new TextEncoder().encode(
      JSON.stringify({
        videos: [
          {
            id: 1,
            url: 'https://www.pexels.com/video/1/',
            image: 'http://images.pexels.test/1.jpg',
            user: { name: 'Ada', url: 'javascript:alert(1)' },
            video_files: files(2, 'https://player.pexels.test/2.mp4'),
          },
          {
            id: 3,
            url: 'https://www.pexels.com/video/3/',
            video_files: files(4, 'http://player.pexels.test/4.mp4'),
          },
          { id: 5, url: 'file:///etc/passwd', video_files: files(6, 'https://player.pexels.test/6.mp4') },
        ],
      }),
    );
    const http = fixtureHttp([{ prefix: 'https://api.pexels.com/', body }]);
    const page = unwrap(
      await pexelsProvider.search(
        { query: 'x', kind: 'video', page: 1 },
        { http, credential: 'k', signal, perPage: 15 },
      ),
    );
    expect(page.hits.map((hit) => hit.providerId)).toEqual(['1']);
    expect(page.hits[0]).toMatchObject({ authorUrl: null, previewUrl: null });
  });

  it('opens the duration range on one side and leaves it off when no bound is set', () => {
    expect(freesoundFilter({})).toBe('license:("Creative Commons 0" OR Attribution)');
    expect(freesoundFilter({ minSeconds: 0.2 })).toBe(
      'license:("Creative Commons 0" OR Attribution) duration:[0.2 TO *]',
    );
    expect(freesoundFilter({ maxSeconds: 30 })).toBe(
      'license:("Creative Commons 0" OR Attribution) duration:[* TO 30]',
    );
  });

  it('ships Pexels only unless the freesound flag is on', () => {
    expect(defaultStockProviders({ freesound: false }).map((provider) => provider.id)).toEqual(['pexels']);
    expect(defaultStockProviders({ freesound: true }).map((provider) => provider.id)).toEqual([
      'pexels',
      'freesound',
    ]);
  });
});
