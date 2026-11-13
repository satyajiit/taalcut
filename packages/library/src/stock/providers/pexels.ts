// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pexels API v1, videos only: GET /v1/videos/search. Authorization is the raw
 * key, with no Bearer prefix. Photos are not requested.
 */
import { err, ok, type StockSearchInput } from '@taalcut/core';
import { z } from 'zod';
import { StockUnavailable } from '../../errors';
import { classifyLicence } from '../licences';
import { jsonFromBytes } from '../../db/json-text';
import { httpsUrl, positiveOrNull, type ProviderHit, type StockProvider } from '../stock-provider';
import { statusError } from './status';

const SEARCH_URL = 'https://api.pexels.com/v1/videos/search';
const MAX_LONG_SIDE = 3840;
const MAX_SHORT_SIDE = 2160;

const fileSchema = z.object({
  id: z.union([z.number(), z.string()]),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  fps: z.number().nullable().optional(),
  link: z.string().min(1),
});
const videoSchema = z.object({
  id: z.union([z.number(), z.string()]),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  url: z.string().min(1),
  image: z.string().min(1).nullable().optional(),
  user: z.object({ name: z.string(), url: z.string().nullable().optional() }).optional(),
  video_files: z.array(fileSchema),
});
const pageSchema = z.object({ videos: z.array(videoSchema) });

export interface PexelsFile {
  readonly id: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: number | null;
  readonly link: string;
}

/** Smallest file at least 1080 wide (1920 tall when portrait), at most 4K, then closest to 30 fps. */
export function choosePexelsRendition(
  files: readonly PexelsFile[],
  orientation: StockSearchInput['orientation'],
): PexelsFile | null {
  const portrait = orientation === 'portrait';
  const eligible = files.filter((file) => {
    const width = file.width ?? 0;
    const height = file.height ?? 0;
    if (!file.link) return false;
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    if (longSide > MAX_LONG_SIDE || shortSide > MAX_SHORT_SIDE) return false;
    return portrait ? height >= 1920 : width >= 1080;
  });
  eligible.sort((left, right) => {
    const area = (file: PexelsFile) => (file.width ?? 0) * (file.height ?? 0);
    const byArea = area(left) - area(right);
    if (byArea !== 0) return byArea;
    const distance = (file: PexelsFile) =>
      file.fps == null ? Number.POSITIVE_INFINITY : Math.abs(file.fps - 30);
    return distance(left) - distance(right);
  });
  return eligible[0] ?? null;
}

function whole(value: number | null | undefined): number | null {
  const number = positiveOrNull(value);
  if (number == null) return null;
  const rounded = Math.round(number);
  return rounded > 0 ? rounded : null;
}

export const pexelsProvider: StockProvider = {
  id: 'pexels',
  kinds: ['video'],
  async search(input, ctx) {
    const url = new URL(SEARCH_URL);
    url.searchParams.set('query', input.query);
    if (input.orientation) url.searchParams.set('orientation', input.orientation);
    url.searchParams.set('page', String(input.page));
    url.searchParams.set('per_page', String(Math.min(80, Math.max(1, ctx.perPage))));
    const response = await ctx.http.get(url.toString(), { Authorization: ctx.credential }, ctx.signal);
    if (!response.ok) return err(StockUnavailable({ provider: 'pexels' }));
    const failed = statusError('pexels', response.value);
    if (failed) return err(failed);
    const parsed = pageSchema.safeParse(jsonFromBytes(response.value.body));
    if (!parsed.success) return err(StockUnavailable({ provider: 'pexels' }));
    const licence = classifyLicence('pexels', 'Pexels-Licence');
    if (!licence.ok) return licence;
    const hits: ProviderHit[] = [];
    for (const video of parsed.data.videos) {
      const files: PexelsFile[] = video.video_files.map((file) => ({
        id: String(file.id),
        width: whole(file.width),
        height: whole(file.height),
        fps: positiveOrNull(file.fps),
        link: file.link,
      }));
      const chosen = choosePexelsRendition(files, input.orientation);
      if (!chosen) continue;
      const authorUrl = httpsUrl(video.user?.url);
      const pageUrl = httpsUrl(video.url);
      const downloadUrl = httpsUrl(chosen.link);
      if (!pageUrl || !downloadUrl) continue;
      hits.push({
        provider: 'pexels',
        providerId: String(video.id).slice(0, 100),
        kind: 'video',
        title: video.user?.name ? video.user.name : `Video ${video.id}`,
        authorName: video.user?.name ?? '',
        authorUrl,
        pageUrl,
        licence: licence.value,
        rawLicence: 'Pexels-Licence',
        seconds: positiveOrNull(video.duration),
        width: whole(video.width),
        height: whole(video.height),
        fps: chosen.fps,
        renditionKey: chosen.id.slice(0, 100),
        downloadUrl,
        previewUrl: httpsUrl(video.image),
        previewRequired: true,
        attribution: '',
      });
    }
    return ok({ hits, headers: response.value.headers });
  },
};
