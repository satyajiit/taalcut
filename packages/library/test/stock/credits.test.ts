// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Required CC-BY lines, Pexels courtesy, and CC0 silence (P3-V18). */
import { creditsSchema, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createAssetRepository, creditsFor } from '../../src/index';
import { openTestDb } from '../helpers';

function make(db: ReturnType<typeof openTestDb>, name: string) {
  return unwrap(createAssetRepository(db).create({ kind: 'audio', sizeBytes: 1, originalFilename: name })).id;
}

function licence(
  db: ReturnType<typeof openTestDb>,
  assetId: string,
  row: {
    source: string;
    providerAssetId: string;
    licence: string;
    raw: string;
    author: string | null;
    attribution: string;
  },
) {
  db.driver
    .prepare(
      `INSERT INTO asset_licences (
         asset_id, source, provider_asset_id, licence, raw_licence, nc_excluded,
         author, author_url, source_url, attribution, fetched_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, NULL, NULL, ?, 1)`,
    )
    .run(assetId, row.source, row.providerAssetId, row.licence, row.raw, row.author, row.attribution);
}

describe('creditsFor', () => {
  it('requires CC-BY, courtesy-lists Pexels, and skips CC0', () => {
    const db = openTestDb({ file: false });
    const by = make(db, 'rain.mp3');
    const byAgain = make(db, 'rain-2.mp3');
    const pexels = make(db, 'waves.mp4');
    const pexelsAgain = make(db, 'waves-2.mp4');
    const cc0 = make(db, 'wind.mp3');
    const line = '"Rain" by sam (https://freesound.org/s/1/) licensed under CC BY 4.0';
    licence(db, by, {
      source: 'freesound',
      providerAssetId: '1',
      licence: 'CC-BY-4.0',
      raw: 'Attribution',
      author: 'sam',
      attribution: line,
    });
    licence(db, byAgain, {
      source: 'freesound',
      providerAssetId: '2',
      licence: 'CC-BY-4.0',
      raw: 'Attribution',
      author: 'sam',
      attribution: line,
    });
    licence(db, pexels, {
      source: 'pexels',
      providerAssetId: '101',
      licence: 'Pexels-Licence',
      raw: 'Pexels-Licence',
      author: 'Ada',
      attribution: '',
    });
    licence(db, pexelsAgain, {
      source: 'pexels',
      providerAssetId: '102',
      licence: 'Pexels-Licence',
      raw: 'Pexels-Licence',
      author: 'Ada',
      attribution: '',
    });
    licence(db, cc0, {
      source: 'freesound',
      providerAssetId: '9',
      licence: 'CC0-1.0',
      raw: 'Creative Commons 0',
      author: null,
      attribution: '',
    });
    const credits = unwrap(creditsFor(db, [by, byAgain, pexels, pexelsAgain, cc0]));
    expect(creditsSchema.parse(credits)).toEqual({
      required: [line],
      courtesy: ['Video by Ada on Pexels'],
    });
    expect(unwrap(creditsFor(db, []))).toEqual({ required: [], courtesy: [] });
  });
});
