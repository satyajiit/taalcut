// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-LANG: a clip's spoken language. What audio.language decided is stored and files the clip (unclear files it
 * under no language); the person's correction wins, re-runs the language and the transcript, is undoable, and
 * reaches the summary search and the agent read; the stage view tells audio.language the chosen language.
 */
import {
  createCommandBus,
  createEventBus,
  systemClock,
  unwrap,
  type AssetId,
  type CommandOrigin,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  applyStageResult,
  buildAssetIndexView,
  createCommandUnitOfWork,
  createRepositories,
  createSetAssetLanguageCommand,
  createStageRows,
  type LibraryDatabase,
} from '../../src/index';
import { assetSummaries } from '../../src/profile/summaries';
import { openTestDb } from '../helpers';
import { addAssets } from './harness';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };

function setup() {
  const db = openTestDb({ file: false });
  const commands = createCommandUnitOfWork(db);
  const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
  const events = createEventBus({ clock: systemClock });
  const changed: unknown[] = [];
  events.on('library.changed', ({ payload }) => changed.push(payload));
  const correction = createSetAssetLanguageCommand({ db, commands });
  bus.register(correction.command);
  correction.announce(bus, events);
  const { assets } = addAssets(db, ['video']);
  const id = assets[0] as AssetId;
  for (const stage of ['media.normalise', 'audio.language', 'audio.transcript'])
    db.driver
      .prepare(
        `INSERT INTO asset_index_stages (asset_id, stage, state, version, output, updated_at)
         VALUES (?, ?, 'done', 1, '{"kept":true}', 0)`,
      )
      .run(id, stage);
  return { db, bus, correction, id, changed, repos: createRepositories(db), rows: createStageRows(db) };
}

const summary = (db: LibraryDatabase, id: AssetId) =>
  assetSummaries(db, [unwrap(createRepositories(db).assets.get(id))])[0];

describe('a clip’s spoken language', () => {
  it('files the clip under the decision, and an unclear one under no language', () => {
    const t = setup();
    const detected = { state: 'detected' as const, languages: ['bn'], confidence: 0.91 };
    unwrap(
      applyStageResult(t.db, t.id, 'audio.language', 0, { language: 'bn', spokenLanguage: detected }, {}),
    );
    expect(summary(t.db, t.id)).toMatchObject({ language: 'bn', speech: detected });
    const unclear = { state: 'unclear' as const, languages: [], confidence: 0.31 };
    unwrap(applyStageResult(t.db, t.id, 'audio.language', 0, { spokenLanguage: unclear }, {}));
    expect(summary(t.db, t.id)).toMatchObject({ language: null, speech: unclear });
  });

  it('takes the person’s language, re-runs the language and the transcript, and undoes', async () => {
    const t = setup();
    const unclear = { state: 'unclear' as const, languages: [], confidence: 0.31 };
    unwrap(applyStageResult(t.db, t.id, 'audio.language', 0, { spokenLanguage: unclear }, {}));

    const receipt = unwrap(await t.bus.dispatch(t.correction.command, { assetId: t.id, language: 'or' }, ui));
    expect(receipt.undoable).toBe(true);
    expect(summary(t.db, t.id)).toMatchObject({
      language: 'or',
      speech: { state: 'chosen', languages: ['or'], confidence: null },
    });
    expect(t.rows.get(t.id, 'audio.language')?.state).toBe('waiting');
    expect(t.rows.get(t.id, 'audio.transcript')?.state).toBe('waiting');
    expect(t.rows.get(t.id, 'media.normalise')?.state).toBe('done');
    const view = buildAssetIndexView(t.db, t.id, { requirePresent: false });
    expect(view.kind === 'view' && view.view.chosenLanguage).toBe('or');
    expect(t.changed).toEqual([{ projectId: null, entity: 'asset', change: 'updated', ids: [t.id] }]);

    // A later decision doesn't override the person.
    const detected = { state: 'detected' as const, languages: ['bn'], confidence: 0.9 };
    unwrap(
      applyStageResult(t.db, t.id, 'audio.language', 1, { language: 'bn', spokenLanguage: detected }, {}),
    );
    expect(summary(t.db, t.id)).toMatchObject({ language: 'or', speech: { state: 'chosen' } });

    unwrap(await t.bus.undo(null, ui));
    expect(summary(t.db, t.id)).toMatchObject({ language: 'bn', speech: detected });
    const back = buildAssetIndexView(t.db, t.id, { requirePresent: false });
    expect(back.kind === 'view' && back.view.chosenLanguage).toBeNull();
  });

  it('refuses an unknown clip and a language that isn’t one', async () => {
    const t = setup();
    const unknown = await t.bus.dispatch(
      t.correction.command,
      { assetId: '01J0000000000000000000000Z' as AssetId, language: 'hi' },
      ui,
    );
    expect(unknown.ok).toBe(false);
    const bad = await t.bus.dispatch(t.correction.command, { assetId: t.id, language: '' }, ui);
    expect(bad.ok).toBe(false);
    expect(t.rows.get(t.id, 'audio.language')?.state).toBe('done');
  });
});
