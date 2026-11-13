// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A music file's beat map (core's BeatMap, from audio's `audio.beats` stage
 * through IndexStageResult.beats), stored on the asset so the timeline's
 * re-time to the user's own track reads it without running the tracker
 * again. Null until the stage ran, and for every asset that isn't music.
 */
import type { Migration } from './types';

const up = `
ALTER TABLE assets ADD COLUMN beat_map TEXT CHECK (beat_map IS NULL OR json_valid(beat_map));
`;

const down = `
ALTER TABLE assets DROP COLUMN beat_map;
`;

export const assetBeatMaps: Migration = { version: 18, name: 'asset_beat_maps', up, down };
