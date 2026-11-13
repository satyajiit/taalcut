// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * REF1-KEEP: a template keeps its reel's video and music (the owner's decision of 2026-10-29, which reverses PRD
 * 10.2's analyse and discard). One row per template, shared by every version (versions are immutable), naming the
 * file in `<app data>/templates/media/<template id>/` (stores/template-media-store.ts). The row goes with its
 * template; the folder goes after the delete commits.
 */
import type { Migration } from './types';

const up = `
CREATE TABLE template_media (
  template_id TEXT PRIMARY KEY NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  file TEXT NOT NULL CHECK (
    length(file) BETWEEN 1 AND 64 AND file GLOB '[a-z0-9]*' AND file NOT GLOB '*[^a-z0-9._-]*'
  ),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  has_audio INTEGER NOT NULL CHECK (has_audio IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('anonymous', 'session', 'file')),
  kept_at INTEGER NOT NULL
) STRICT;
`;

const down = `
DROP TABLE template_media;
`;

export const templateMedia: Migration = { version: 37, name: 'template_media', up, down };
