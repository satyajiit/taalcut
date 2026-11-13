// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-IDX: two kinds of stage failure the round fixed run once more.
 *
 * - `vision.ocr` failed with `vision.ocr_unavailable` where its PP-OCR model wasn't installed yet (Linux: every clip,
 *   "ppocr-v5-latin is not installed"; a Mac: Hindi before ppocr-v5-devanagari). Vision now says
 *   `vision.model_missing`, which the pipeline holds until the model is there (model-missing.ts), so these clips
 *   read "couldn't finish analysing" for a download. The row keeps no detail, so a missing model can't be told from
 *   another language it couldn't read; both run again once, and only a real failure fails again.
 * - `media.filmstrip` failed with `media.ffmpeg_failed` on a 10-bit original's proxy on CUDA (media's settled plan
 *   downloaded NV12 frames as P010, exit 234).
 *
 * Each such row goes back to plain waiting, so the pipeline feeds it like any other. Forward-only: down leaves the
 * rows as they are, since nothing records which were reset.
 */
import type { Migration } from './types';

// As Try again (stage-rows.ts retryFailed) resets a row: plain waiting, no error, no attempts.
const up = `
UPDATE asset_index_stages
  SET state = 'waiting', job_id = NULL, error = NULL, reason_key = NULL, attempts = 0,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE state = 'failed' AND error IS NOT NULL AND (
    (stage = 'vision.ocr' AND json_extract(error, '$.code') = 'vision.ocr_unavailable')
    OR (stage = 'media.filmstrip' AND json_extract(error, '$.code') = 'media.ffmpeg_failed'));
`;

const down = `-- Forward-only: the failures were the app's, not the files'; nothing to restore.`;

export const retryModelAndFilmstripFailures: Migration = {
  version: 32,
  name: 'retry_model_and_filmstrip_failures',
  up,
  down,
};
