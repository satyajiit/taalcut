// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 32 (UX3-IDX): a `vision.ocr` row an older build failed with `vision.ocr_unavailable` (its PP-OCR model
 * wasn't installed) and a `media.filmstrip` row failed with `media.ffmpeg_failed` (a 10-bit proxy on CUDA) go back to
 * plain waiting, as Try again leaves them. Other failures, other stages and other states stay as they were; down
 * changes nothing.
 */
import { unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createStageRows, type LibraryDatabase } from '../src/index';
import { openTestDb } from './helpers';
import { addAssets } from './indexing/harness';

const error = (code: string, params: Record<string, unknown> = {}) =>
  JSON.stringify({ code, messageKey: `errors.${code}`, retryable: false, params });

function row(db: LibraryDatabase, assetId: string, stage: string, state: string, stored: string | null) {
  db.driver
    .prepare(
      `INSERT INTO asset_index_stages (asset_id, stage, state, error, attempts, job_id, updated_at)
       VALUES (?, ?, ?, ?, 2, ?, 1)`,
    )
    .run(assetId, stage, state, stored, state === 'failed' ? null : 'job-1');
}

describe('migration 32: retry the model and filmstrip failures', () => {
  it('puts the OCR rows that failed for a missing model and the failed filmstrips back to waiting', () => {
    const db = openTestDb({ targetVersion: 31 });
    const { assets } = addAssets(db, ['video', 'video', 'video']);
    const [a, b, c] = assets as [AssetId, AssetId, AssetId];
    row(db, a, 'vision.ocr', 'failed', error('vision.ocr_unavailable', { language: 'en' }));
    row(db, a, 'media.filmstrip', 'failed', error('media.ffmpeg_failed', { exitCode: 234 }));
    row(db, b, 'vision.ocr', 'failed', error('vision.ocr_failed'));
    row(db, b, 'media.filmstrip', 'done', null);
    row(db, c, 'vision.shots', 'failed', error('media.ffmpeg_failed', { exitCode: 234 }));
    row(db, c, 'media.proxy', 'failed', error('vision.ocr_unavailable'));

    unwrap(db.migrateTo(32));
    const rows = createStageRows(db);
    for (const stage of ['vision.ocr', 'media.filmstrip'])
      expect(rows.get(a, stage)).toMatchObject({
        state: 'waiting',
        error: null,
        reasonKey: null,
        jobId: null,
      });
    expect(
      db.driver
        .prepare(`SELECT attempts, updated_at > 1 AS touched FROM asset_index_stages WHERE asset_id = ?`)
        .all(a),
    ).toEqual([
      { attempts: 0, touched: 1 },
      { attempts: 0, touched: 1 },
    ]);
    // Another OCR failure, a done filmstrip, and the same codes on other stages are left alone.
    expect(rows.get(b, 'vision.ocr')).toMatchObject({
      state: 'failed',
      error: { code: 'vision.ocr_failed' },
    });
    expect(rows.get(b, 'media.filmstrip')?.state).toBe('done');
    expect(rows.get(c, 'vision.shots')?.state).toBe('failed');
    expect(rows.get(c, 'media.proxy')?.state).toBe('failed');

    unwrap(db.migrateTo(31));
    expect(rows.get(a, 'vision.ocr')?.state).toBe('waiting');
  });
});
