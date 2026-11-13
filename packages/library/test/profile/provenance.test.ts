// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Each asset's stored provenance on its summary and through render's lookup: captured by default, generated,
 * bundled or stock as written, a damaged value read as captured (never generated), an unknown asset not found.
 */
import { newId, unwrap, type AssetProvenance } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  assetSummaries,
  createAssetRepository,
  createProvenanceLookup,
  type LibraryDatabase,
} from '../../src/index';
import { openTestDb } from '../helpers';

const GENERATED: AssetProvenance = {
  kind: 'generated',
  generation: 'image',
  provider: 'openai',
  model: 'gpt-image-2',
  access: 'api-key',
  quality: null,
  promptSha256: 'b'.repeat(64),
  voiceId: null,
  providerRef: null,
  c2pa: 'present',
  costUsd: 0.04,
  runId: null,
  createdAt: 1,
};

const BUNDLED: AssetProvenance = {
  kind: 'bundled',
  pack: 'sfx-pack',
  itemId: 'whoosh-01',
  licence: 'CC0-1.0',
  sourceUrl: 'https://taalcut.app/packs/sfx',
  title: 'Whoosh',
};

function assetWith(db: LibraryDatabase, provenance?: string) {
  const created = unwrap(
    createAssetRepository(db).create({ kind: 'image', sizeBytes: 1, originalFilename: 'a.png' }),
  );
  if (provenance !== undefined)
    db.driver.prepare('UPDATE assets SET provenance = ? WHERE id = ?').run(provenance, created.id);
  return unwrap(createAssetRepository(db).get(created.id));
}

describe('asset provenance', () => {
  it('reads each asset’s own provenance onto its summary and through the lookup', async () => {
    const db = openTestDb({ file: false });
    const rows = [
      assetWith(db),
      assetWith(db, JSON.stringify(GENERATED)),
      assetWith(db, JSON.stringify(BUNDLED)),
      assetWith(db, '{"kind":"generated"}'),
    ];
    expect(assetSummaries(db, rows).map((summary) => summary.provenance)).toEqual([
      { kind: 'captured' },
      GENERATED,
      BUNDLED,
      { kind: 'captured' },
    ]);
    const lookup = createProvenanceLookup(db);
    const kinds = await Promise.all(rows.map(async (row) => unwrap(await lookup(row.id))));
    expect(kinds).toEqual(['captured', 'generated', 'bundled', 'captured']);
  });

  it('answers not found for an asset the library doesn’t have', async () => {
    const db = openTestDb({ file: false });
    const missing = await createProvenanceLookup(db)(newId<'Asset'>());
    expect(missing.ok ? null : missing.error.code).toBe('core.not_found');
  });
});
