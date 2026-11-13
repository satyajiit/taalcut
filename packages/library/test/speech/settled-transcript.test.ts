// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-LANG: a transcript is read in the clip's settled language, never the transcriber's guess. Whisper names a
 * language on every run, even one that wrote nothing (a second or two of speech it couldn't place comes back as some
 * language with no segments). Every reader, from the clip page's detail and the transcript's pages to the agent's
 * asset tool, gets the person's choice, else the decision, else `und` when detection called it unclear. A clip
 * decided before LIB1 keeps a written transcript's language, and an empty one names none. Synthetic clips and words.
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
import { createRepositories, type LibraryDatabase } from '../../src/index';
import { assetDetail } from '../../src/profile';
import { assetToolOutput } from '../../src/search/asset-tool';
import { createAssetLanguageRepository } from '../../src/speech/asset-language';
import { openTestDb } from '../helpers';

const ms = (value: number) => RationalTime.of(value, { num: 1000, den: 1 });

/** What the transcriber returned: its own language, and `text` as one segment (none when empty). */
function whisper(language: string, text = ''): Transcript {
  return {
    version: 1,
    language,
    engine: 'whisper',
    model: 'ggml-tiny',
    local: true,
    wordTiming: 'native',
    segments: text ? [{ text, language, range: TimeRange.of(ms(0), ms(1500)), words: [] }] : [],
  };
}

const noArtifacts: ArtifactStore = {
  put: async () => err(NotFoundError({ entity: 'artifact', id: 'none' })),
  get: async () => err(NotFoundError({ entity: 'artifact', id: 'none' })),
};

function clip(db: LibraryDatabase, transcript: Transcript): AssetId {
  const repos = createRepositories(db);
  const asset = unwrap(repos.assets.create({ kind: 'video', sizeBytes: 1, originalFilename: 'clip.mov' }));
  unwrap(repos.transcripts.put(asset.id, transcript, 1));
  return asset.id;
}

/** The language every reader shows: the detail, a page of the transcript and the agent's asset tool. */
async function shown(db: LibraryDatabase, id: AssetId) {
  const detail = unwrap(assetDetail(db, id));
  const page = createRepositories(db).transcripts.page(id, 0, 10);
  const tool = unwrap(await assetToolOutput(db, { assetId: id, include: ['transcript'] }, noArtifacts));
  return { detail: detail.transcript?.language, page: page?.language, tool: tool.transcript?.language };
}

describe('the transcript’s language is the clip’s settled one', () => {
  it('unclear speech that Whisper wrote nothing for names no language, not Whisper’s guess', async () => {
    const db = openTestDb({ file: false });
    const id = clip(db, whisper('ne'));
    unwrap(
      createAssetLanguageRepository(db).setOutcome(id, { state: 'unclear', languages: [], confidence: 0.2 }),
    );
    expect(await shown(db, id)).toEqual({ detail: 'und', page: 'und', tool: 'und' });
    // The words are still there for whoever reads them; only the language is settled.
    expect(unwrap(assetDetail(db, id)).transcript?.lines).toEqual([]);
  });

  it('a detected language wins over the transcriber’s, and the person’s choice over both', async () => {
    const db = openTestDb({ file: false });
    const id = clip(db, whisper('ne', 'नमस्ते'));
    const languages = createAssetLanguageRepository(db);
    unwrap(languages.setOutcome(id, { state: 'detected', languages: ['hi'], confidence: 0.9 }));
    expect(await shown(db, id)).toEqual({ detail: 'hi', page: 'hi', tool: 'hi' });
    unwrap(languages.setOutcome(id, { state: 'mixed', languages: ['hi', 'en'], confidence: 0.85 }));
    expect((await shown(db, id)).detail).toBe('hi');
    unwrap(languages.setChosen(id, 'or'));
    expect(await shown(db, id)).toEqual({ detail: 'or', page: 'or', tool: 'or' });
  });

  it('a clip decided before LIB1 keeps a written transcript’s language, and an empty one names none', async () => {
    const db = openTestDb({ file: false });
    const written = clip(db, whisper('es', 'Hola a todos'));
    const empty = clip(db, whisper('ne'));
    expect((await shown(db, written)).detail).toBe('es');
    expect(await shown(db, empty)).toEqual({ detail: 'und', page: 'und', tool: 'und' });
  });
});
