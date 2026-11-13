// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * REF1 (gate finding 8): a reel link copied from an app carries the sharer's tokens (Instagram's `igsh`, `rpxt`,
 * `srtk`, `utm_*`; YouTube's `si`, `pp`, `feature`; TikTok's `_r`, `_t`, `is_from_webapp`, `sender_device`).
 * Templates made before the fix kept the whole link in `origin.url`. The export's Sound step shows that link and
 * copies it, and `templates.fetchMedia` fetches from it.
 *
 * This migration rewrites each stored version's link to what identifies the video:
 * - Instagram's `/reel/<id>/`, `/p/<id>/` or `/tv/<id>/`;
 * - YouTube's path, keeping only `v` on `watch`;
 * - TikTok's path.
 *
 * It changes data in place rather than cleaning at every read, so the tokens leave the database once and every
 * reader (the library's summaries, render's credit, a fetch) gets the bare link without its own copy of the rule.
 * Only `origin.url` changes, through json_set, so the rest of each document stays as it was. A link that doesn't
 * parse, or isn't one of these hosts, is left alone.
 *
 * The rule here is a copy of the one templates' intake/reference-link.ts applies to every new link: what a shipped
 * migration writes never changes, even if that rule does.
 *
 * Down changes nothing back: the tokens are not kept anywhere to restore.
 */
import type { Migration } from './types';

const YOUTUBE = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const INSTAGRAM = new Set(['instagram.com', 'www.instagram.com']);
const TIKTOK = new Set(['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
const INSTAGRAM_POST = /^\/(?:(?!share\/)[^/]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]+)\/?$/;

/** The link without the sharer's tokens, or null to leave it as it is. */
export function referenceLinkAt38(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (INSTAGRAM.has(host)) {
    const post = INSTAGRAM_POST.exec(url.pathname);
    if (post) return `https://www.instagram.com/${post[1] === 'reels' ? 'reel' : post[1]}/${post[2]}/`;
  } else if (!YOUTUBE.has(host) && host !== 'youtu.be' && !TIKTOK.has(host)) return null;
  const video = YOUTUBE.has(host) && url.pathname === '/watch' ? url.searchParams.get('v') : null;
  url.search = video ? new URLSearchParams({ v: video }).toString() : '';
  url.hash = '';
  return url.toString();
}

const NOTHING = `-- Migration 38 rewrites template documents in fill; the schema does not change.\n`;

export const templateReferenceLinks: Migration = {
  version: 38,
  name: 'template_reference_links',
  up: NOTHING,
  down: NOTHING,
  fill(driver) {
    const write = driver.prepare(
      `UPDATE template_versions SET document = json_set(document, '$.origin.url', ?)
       WHERE template_id = ? AND version = ?`,
    );
    const rows = driver
      .prepare(
        `SELECT template_id, version, json_extract(document, '$.origin.url') AS url FROM template_versions
         WHERE origin = 'reference' AND json_type(document, '$.origin.url') = 'text'`,
      )
      .all();
    for (const row of rows) {
      const url = String(row.url);
      const clean = referenceLinkAt38(url);
      if (clean !== null && clean !== url) write.run(clean, row.template_id ?? null, row.version ?? null);
    }
  },
};
