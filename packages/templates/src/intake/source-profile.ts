// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, type Result } from '@taalcut/core';
import { UnsupportedLink } from '../errors';
import type { ReferenceLink } from './reference-link';

/** A separate source-import profile; reference reel limits must remain unchanged. */
export const SOURCE_FETCH_LIMITS = {
  maxSeconds: 4 * 60 * 60,
  maxFileBytes: 4 * 1024 ** 3,
  maxFileSize: '4G',
  /** Independent video/audio files and the merged output coexist until yt-dlp cleans them up. */
  scratchBytes: 12 * 1024 ** 3,
  timeoutMs: 2 * 60 * 60_000,
  format: 'bv*[height<=2160]+ba/b[height<=2160]',
} as const;

/** Accept one YouTube video, never a channel, search, feed or playlist download. */
export function parseSourceVideoLink(raw: string): Result<ReferenceLink> {
  const refuse = () => err(UnsupportedLink(undefined, { detail: 'Expected one HTTPS YouTube video link' }));
  if (raw.length > 2048) return refuse();
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return refuse();
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return refuse();
  let id: string | null = null;
  if (url.hostname === 'youtu.be') id = /^\/([\w-]{11})\/?$/u.exec(url.pathname)?.[1] ?? null;
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : (/^\/(?:shorts|live)\/([\w-]{11})\/?$/u.exec(url.pathname)?.[1] ?? null);
  }
  if (!id || !/^[\w-]{11}$/u.test(id)) return refuse();
  return ok({ platform: 'other', url: `https://www.youtube.com/watch?v=${id}` });
}

export interface SourceVideoMetadata {
  readonly title?: string;
  readonly channel?: string;
  readonly channelUrl?: string;
  readonly uploaderId?: string;
}

export function parseSourceVideoMetadata(line?: string): SourceVideoMetadata | undefined {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line ?? '') as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!record || typeof record !== 'object') return undefined;
  const clean = (value: unknown) =>
    typeof value === 'string'
      ? [...value]
          .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
          .join('')
          .trim()
          .slice(0, 200) || undefined
      : undefined;
  const title = clean(record.title);
  const channel = clean(record.channel);
  const uploaderId = clean(record.uploader_id);
  let channelUrl: string | undefined;
  if (typeof record.channel_url === 'string') {
    try {
      const url = new URL(record.channel_url);
      if (
        url.protocol === 'https:' &&
        ['www.youtube.com', 'youtube.com'].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.port &&
        /^\/(?:channel\/|@)[\w@.-]+\/?$/u.test(url.pathname)
      ) {
        channelUrl = `https://www.youtube.com${url.pathname}`;
      }
    } catch {
      /* Optional metadata must never prevent source intake. */
    }
  }
  return {
    ...(title ? { title } : {}),
    ...(channel ? { channel } : {}),
    ...(channelUrl ? { channelUrl } : {}),
    ...(uploaderId ? { uploaderId } : {}),
  };
}
