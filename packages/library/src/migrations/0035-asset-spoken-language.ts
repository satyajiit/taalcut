// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's spoken language as decided (LIB1-LANG): `asset_spoken_language`, one row per asset with speech. `outcome`
 * is what `audio.language` decided (core's SpokenLanguageOutcome: detected, mixed or unclear, with its confidence);
 * `chosen` is the language the person set with `library.setAssetLanguage`, which wins over the outcome from then on.
 * `assets.language` stays the effective language search and the agent read: the chosen one, else the outcome's
 * first, else null (unclear). The row goes with its asset.
 */
import type { Migration } from './types';

const up = `
CREATE TABLE asset_spoken_language (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  outcome TEXT CHECK (outcome IS NULL OR json_valid(outcome)),
  chosen TEXT CHECK (chosen IS NULL OR length(chosen) BETWEEN 2 AND 35),
  chosen_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;
`;

const down = `
DROP TABLE asset_spoken_language;
`;

export const assetSpokenLanguage: Migration = { version: 35, name: 'asset_spoken_language', up, down };
