// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-LANG: a language with no decision behind it isn't named. A clip analysed before LIB1 holds the old step's
 * guess in `assets.language`, and until the queue reaches it again there is no decision. Right after launch its
 * language step is still done at the old version; once the queue is idle the version rise puts it back to waiting.
 * In both cases the summary names no language and says it's being decided again, the language filter doesn't file
 * it, the agent's asset tool names none, and neither does its transcript. Once the new step finds no speech, the
 * clip names no language and isn't pending. A decision, a choice, a generated file's own words and a clip the
 * pipeline never seeded still name theirs. Synthetic clips and words.
 */
import {
  err,
  NotFoundError,
  RationalTime,
  TimeRange,
  unwrap,
  type ArtifactStore,
  type AssetId,
  type Transcript,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, filterSql, type LibraryDatabase } from '../../src/index';
import { assetDetail } from '../../src/profile';
import { assetSummaries } from '../../src/profile/summaries';
import { assetToolOutput } from '../../src/search/asset-tool';
import { createAssetLanguageRepository, storeSpokenLanguage } from '../../src/speech/asset-language';
import { openTestDb } from '../helpers';
import { addAssets } from '../indexing/harness';

const ms = (value: number) => RationalTime.of(value, { num: 1000, den: 1 });

function words(language: string, engine: Transcript['engine'] = 'whisper'): Transcript {
  return {
    version: 1,
    language,
    engine,
    model: engine === 'tts' ? 'voice' : 'ggml-medium',
    local: engine !== 'tts',
    wordTiming: 'native',
    segments: [{ text: 'Hola a todos', language, range: TimeRange.of(ms(0), ms(1500)), words: [] }],
  };
}

const noArtifacts: ArtifactStore = {
  put: async () => err(NotFoundError({ entity: 'artifact', id: 'none' })),
  get: async () => err(NotFoundError({ entity: 'artifact', id: 'none' })),
};

/** The language step's row, as the pipeline leaves it. */
const QUEUED_AT_NEW_VERSION = { state: 'waiting', version: 3, output: null };
const DONE_AT_OLD_VERSION = {
  state: 'done',
  version: 2,
  output: JSON.stringify({
    language: 'es',
    probability: 0.41,
    perSlice: [{ language: 'es', probability: 0.41 }],
  }),
};
const FOUND_SILENT = { state: 'done', version: 3, output: JSON.stringify({ silent: true }) };

let sources = 0;

/** A clip whose language the old step filed as 'es', with a transcript written in it. */
function clip(
  db: LibraryDatabase,
  step: { state: string; version: number; output: string | null } | null,
  engine: Transcript['engine'] = 'whisper',
): AssetId {
  const repos = createRepositories(db);
  const id = addAssets(db, ['video'], { sourceName: `Trip ${(sources += 1)}` }).assets[0] as AssetId;
  unwrap(repos.assets.setLanguage(id, 'es'));
  unwrap(repos.transcripts.put(id, words('es', engine), 1));
  if (step)
    db.driver
      .prepare(
        `INSERT INTO asset_index_stages (asset_id, stage, state, version, output, updated_at)
         VALUES (?, 'audio.language', ?, ?, ?, 0)`,
      )
      .run(id, step.state, step.version, step.output);
  return id;
}

/** What each reader names: the summary, the language filter, the agent's asset tool and the transcript. */
async function named(db: LibraryDatabase, id: AssetId, language = 'es') {
  const summary = assetSummaries(db, [unwrap(createRepositories(db).assets.get(id))])[0];
  const filter = filterSql({ languages: [language] });
  const filed = db.driver
    .prepare(`SELECT a.id AS id FROM assets a WHERE ${filter.where}`)
    .all(...filter.params) as { id: AssetId }[];
  const tool = unwrap(await assetToolOutput(db, { assetId: id, include: ['transcript'] }, noArtifacts));
  return {
    language: summary?.language,
    pending: summary?.languagePending ?? false,
    filed: filed.some((row) => row.id === id),
    tool: tool.asset.language,
    transcript: unwrap(assetDetail(db, id)).transcript?.language,
  };
}

const HELD = { language: null, pending: true, filed: false, tool: null, transcript: 'und' };

describe('a language with no decision behind it isn’t named', () => {
  it('right after launch: the old step’s guess, its step done at the old version', async () => {
    const db = openTestDb({ file: false });
    expect(await named(db, clip(db, DONE_AT_OLD_VERSION))).toEqual(HELD);
  });

  it('once the queue was idle: the step queued again at the new version', async () => {
    const db = openTestDb({ file: false });
    expect(await named(db, clip(db, QUEUED_AT_NEW_VERSION))).toEqual(HELD);
  });

  it('the new step found no speech: no language, and not pending', async () => {
    const db = openTestDb({ file: false });
    expect(await named(db, clip(db, FOUND_SILENT))).toEqual({ ...HELD, pending: false });
  });

  it('a decision or the person’s choice names it, filed and read alike', async () => {
    const db = openTestDb({ file: false });
    const id = clip(db, QUEUED_AT_NEW_VERSION);
    const assets = createRepositories(db).assets;
    const detected = { state: 'detected' as const, languages: ['pt'], confidence: 0.9 };
    unwrap(storeSpokenLanguage(db, id, detected, assets));
    const decided = { language: 'pt', pending: false, filed: true, tool: 'pt', transcript: 'pt' };
    expect(await named(db, id, 'pt')).toEqual(decided);
    unwrap(createAssetLanguageRepository(db).setChosen(id, 'gl'));
    unwrap(assets.setLanguage(id, 'gl'));
    expect(await named(db, id, 'gl')).toEqual({ ...decided, language: 'gl', tool: 'gl', transcript: 'gl' });
  });

  it('a generated file’s own words, and a clip the pipeline never seeded, keep their language', async () => {
    const db = openTestDb({ file: false });
    const kept = { language: 'es', pending: false, filed: true, tool: 'es', transcript: 'es' };
    expect(await named(db, clip(db, QUEUED_AT_NEW_VERSION, 'tts'))).toEqual(kept);
    expect(await named(db, clip(db, null))).toEqual(kept);
  });
});
