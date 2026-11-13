// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Freesound APIv2 search. Off unless the build flag is on. The HQ mp3 preview
 * is the download; the OAuth original is not requested. Authorization is
 * `Token <key>`, not Bearer.
 */
import { err, ok, type StockSearchInput } from '@taalcut/core';
import { z } from 'zod';
import { StockUnavailable } from '../../errors';
import { attributionLine, classifyLicence } from '../licences';
import { jsonFromBytes } from '../../db/json-text';
import { httpsUrl, positiveOrNull, type ProviderHit, type StockProvider } from '../stock-provider';
import { statusError } from './status';

const SEARCH_URL = 'https://freesound.org/apiv2/search/';
const FIELDS = 'id,name,username,license,url,duration,previews,type';
const LICENCE_FILTER = 'license:("Creative Commons 0" OR Attribution)';

/** The allow-list, plus a Solr duration range when the caller set bounds. */
export function freesoundFilter(input: Pick<StockSearchInput, 'minSeconds' | 'maxSeconds'>): string {
  if (input.minSeconds == null && input.maxSeconds == null) return LICENCE_FILTER;
  const min = input.minSeconds ?? '*';
  const max = input.maxSeconds ?? '*';
  return `${LICENCE_FILTER} duration:[${min} TO ${max}]`;
}

const soundSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  username: z.string(),
  license: z.string(),
  url: z.string(),
  duration: z.number().nullable().optional(),
  previews: z.record(z.string(), z.string()).optional(),
  type: z.string().optional(),
});
const pageSchema = z.object({ results: z.array(soundSchema) });

export const freesoundProvider: StockProvider = {
  id: 'freesound',
  kinds: ['soundEffect'],
  async search(input, ctx) {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('query', input.query);
    url.searchParams.set('filter', freesoundFilter(input));
    url.searchParams.set('fields', FIELDS);
    url.searchParams.set('page', String(input.page));
    url.searchParams.set('page_size', String(Math.min(150, Math.max(1, ctx.perPage))));
    const response = await ctx.http.get(
      url.toString(),
      { Authorization: `Token ${ctx.credential}` },
      ctx.signal,
    );
    if (!response.ok) return err(StockUnavailable({ provider: 'freesound' }));
    const failed = statusError('freesound', response.value);
    if (failed) return err(failed);
    const parsed = pageSchema.safeParse(jsonFromBytes(response.value.body));
    if (!parsed.success) return err(StockUnavailable({ provider: 'freesound' }));
    const hits: ProviderHit[] = [];
    for (const sound of parsed.data.results) {
      const licence = classifyLicence('freesound', sound.license);
      if (!licence.ok) continue;
      const preview = sound.previews?.['preview-hq-mp3'];
      const pageUrl = httpsUrl(sound.url);
      const downloadUrl = httpsUrl(preview);
      if (!pageUrl || !downloadUrl) continue;
      const id = String(sound.id).slice(0, 100);
      hits.push({
        provider: 'freesound',
        providerId: id,
        kind: 'soundEffect',
        title: sound.name,
        authorName: sound.username,
        authorUrl: null,
        pageUrl,
        licence: licence.value,
        rawLicence: sound.license,
        seconds: positiveOrNull(sound.duration),
        width: null,
        height: null,
        fps: null,
        renditionKey: 'preview-hq-mp3',
        downloadUrl,
        previewUrl: null,
        previewRequired: false,
        attribution: attributionLine(licence.value, { title: sound.name, author: sound.username, id }),
      });
    }
    return ok({ hits, headers: response.value.headers });
  },
};
