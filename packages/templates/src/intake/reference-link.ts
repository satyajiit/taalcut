// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Link checks for reference intake (P2-T3): https only, no credentials or
 * port, and only the hosts of Shorts, Reels and TikTok. Anything else is
 * `templates.unsupported_link`; the link itself goes in `detail` only (it may
 * carry a session token), never in params.
 *
 * REF1 (gate finding 8): a shared link carries the sharer's tokens (Instagram's
 * `igsh`, `rpxt`, `srtk`, `utm_*`; YouTube's `si`, `pp`, `feature`; TikTok's
 * `_r`, `_t`, `is_from_webapp`, `sender_device`). The link is cut down to what
 * identifies the video before anything fetches, stores or shows it: Instagram
 * `/reel/<id>/` (or `/p/`, `/tv/`), YouTube `/shorts/<id>`, `youtu.be/<id>` or
 * `watch?v=<id>`, TikTok's path. No query parameter survives but YouTube's `v`,
 * which `watch` needs. An allowlist, so a tracking parameter nobody has named
 * yet goes too. Library migration 38 cleans the links stored before this.
 */
import { err, ok, type Result } from '@taalcut/core';
import { UnsupportedLink } from '../errors';
import type { ReferencePlatform } from '../types';

export interface ReferenceLink {
  /** The link as yt-dlp gets it and a template keeps it: https, no fragment, no share or tracking tokens. */
  readonly url: string;
  readonly platform: ReferencePlatform;
}

const YOUTUBE = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const INSTAGRAM = new Set(['instagram.com', 'www.instagram.com']);
const TIKTOK = new Set(['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
const MAX_LENGTH = 2048;
/** `/reel/<id>/`, `/reels/<id>/`, `/p/<id>/`, `/tv/<id>/`, after an optional handle; not a `/share/…` redirect. */
const INSTAGRAM_POST = /^\/(?:(?!share\/)[^/]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]+)\/?$/;

function platformOf(url: URL): ReferencePlatform | null {
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be') return 'shorts';
  if (YOUTUBE.has(host)) return url.pathname.startsWith('/shorts/') ? 'shorts' : 'other';
  if (INSTAGRAM.has(host)) return 'reels';
  if (TIKTOK.has(host)) return 'tiktok';
  return null;
}

/** The link cut down to what identifies the video: the path, and YouTube's `v` on `watch`. */
function identifying(url: URL, platform: ReferencePlatform): string {
  if (platform === 'reels') {
    const post = INSTAGRAM_POST.exec(url.pathname);
    if (post) return `https://www.instagram.com/${post[1] === 'reels' ? 'reel' : post[1]}/${post[2]}/`;
  }
  const video =
    YOUTUBE.has(url.hostname.toLowerCase()) && url.pathname === '/watch' ? url.searchParams.get('v') : null;
  url.search = video ? new URLSearchParams({ v: video }).toString() : '';
  url.hash = '';
  return url.toString();
}

export function parseReferenceLink(raw: string): Result<ReferenceLink> {
  const text = raw.trim();
  const refuse = (why: string) => err(UnsupportedLink(undefined, { detail: why }));
  if (text.length === 0 || text.length > MAX_LENGTH) return refuse('empty or longer than 2048 characters');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return refuse('not a URL');
  }
  if (url.protocol !== 'https:') return refuse(`protocol ${url.protocol}`);
  if (url.username !== '' || url.password !== '') return refuse('credentials in the link');
  if (url.port !== '') return refuse('a port in the link');
  const platform = platformOf(url);
  if (!platform) return refuse(`host ${url.hostname}`);
  return ok({ url: identifying(url, platform), platform });
}
