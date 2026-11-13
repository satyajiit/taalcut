// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Saved on Instagram: cached collection and saved Reel metadata in the local
 * library. Only metadata, thumbnails and public Reel URLs live here; no session
 * cookies or tokens ever touch SQLite.
 */
import type { Migration } from './types';

const up = `
CREATE TABLE instagram_collections (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  media_count INTEGER NOT NULL DEFAULT 0,
  cover_url TEXT,
  watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
  auto_breakdown INTEGER NOT NULL DEFAULT 0 CHECK (auto_breakdown IN (0, 1)),
  last_synced_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE instagram_saved_reels (
  shortcode TEXT PRIMARY KEY NOT NULL,
  media_pk TEXT NOT NULL,
  collection_id TEXT NOT NULL REFERENCES instagram_collections(id) ON DELETE CASCADE,
  permalink TEXT NOT NULL,
  caption TEXT,
  author_handle TEXT,
  duration_ms INTEGER,
  thumbnail_url TEXT,
  saved_at INTEGER NOT NULL,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL
) STRICT;
CREATE INDEX instagram_saved_reels_collection_idx ON instagram_saved_reels(collection_id, saved_at, shortcode);
CREATE INDEX instagram_saved_reels_template_idx ON instagram_saved_reels(template_id) WHERE template_id IS NOT NULL;
`;

const down = `
DROP TABLE instagram_saved_reels;
DROP TABLE instagram_collections;
`;

export const instagramSaved: Migration = { version: 29, name: 'instagram_saved', up, down };
