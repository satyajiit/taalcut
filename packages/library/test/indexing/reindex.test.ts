// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** `library.reindexAssets` on core's command bus: one audited write, not undoable, hash kept. */
import { createCommandBus, systemClock, unwrap, type AssetId, type CommandOrigin } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createCommandUnitOfWork,
  createReindexCommand,
  createRepositories,
  createStageRows,
} from '../../src/index';
import { openTestDb } from '../helpers';
import { addAssets } from './harness';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };

function setup() {
  const db = openTestDb({ file: false });
  const commands = createCommandUnitOfWork(db);
  const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
  const reindex = createReindexCommand({ db, commands });
  bus.register(reindex);
  const { assets } = addAssets(db, ['video', 'image']);
  const rows = createStageRows(db);
  for (const id of assets)
    for (const stage of ['library.hash', 'media.normalise', 'vision.analyse'])
      db.driver
        .prepare(
          `INSERT INTO asset_index_stages (asset_id, stage, state, version, output, updated_at)
           VALUES (?, ?, 'done', 1, '{"kept":true}', 0)`,
        )
        .run(id, stage);
  return { db, bus, reindex, assets: assets as AssetId[], rows, repos: createRepositories(db) };
}

describe('library.reindexAssets', () => {
  it('bumps the generation and resets every stage after library.hash, with an audit row', async () => {
    const t = setup();
    const receipt = unwrap(await t.bus.dispatch(t.reindex, { assetIds: [t.assets[0]!] }, ui));
    expect(receipt.undoable).toBe(false);
    expect(unwrap(t.repos.assets.get(t.assets[0]!)).generation).toBe(1);
    expect(unwrap(t.repos.assets.get(t.assets[1]!)).generation).toBe(0);
    expect(t.rows.get(t.assets[0]!, 'library.hash')).toMatchObject({ state: 'done', output: { kept: true } });
    expect(t.rows.get(t.assets[0]!, 'media.normalise')).toMatchObject({
      state: 'waiting',
      generation: 1,
      output: null,
    });
    expect(t.rows.get(t.assets[1]!, 'media.normalise')?.state).toBe('done');
    expect(unwrap(t.repos.auditLog.listByProject(null)).map((e) => e.name)).toEqual([
      'library.reindexAssets',
    ]);
  });

  it('resets only the chosen stages', async () => {
    const t = setup();
    unwrap(await t.bus.dispatch(t.reindex, { assetIds: t.assets, stages: ['vision.analyse'] }, ui));
    for (const id of t.assets) {
      expect(t.rows.get(id, 'media.normalise')?.state).toBe('done');
      expect(t.rows.get(id, 'vision.analyse')?.state).toBe('waiting');
    }
  });

  it('refuses an unknown asset and changes nothing', async () => {
    const t = setup();
    const result = await t.bus.dispatch(
      t.reindex,
      { assetIds: ['01J0000000000000000000000Z' as AssetId] },
      ui,
    );
    expect(!result.ok && result.error.code).toBe('core.not_found');
    expect(unwrap(t.repos.auditLog.listByProject(null))).toEqual([]);
  });
});
