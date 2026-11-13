// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A generated file's exact words (core GeneratedFile.transcript, round P3-3): the sink stores a voice line's
 * transcript (engine `tts`) and its language with the asset, refuses a malformed one, keeps the generator's words
 * when the same bytes come again; indexing skips the speech stages for that asset (also after a re-index) while
 * an imported clip is still transcribed.
 */
import {
  createEventBus,
  RationalTime,
  TimeRange,
  unwrap,
  ValidationError,
  type GeneratedFile,
  type Transcript,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createAssetRepository,
  createIndexingPipeline,
  createStageRows,
  createTranscriptRepository,
  TRANSCRIPT_PROVIDED,
} from '../../src/index';
import { addAssets, createTestQueue, runPipeline } from '../indexing/harness';
import { KINDS, stubStages } from '../indexing/stages';
import { row, setup } from './fixture';

const ms = (value: number) => RationalTime.of(value, { num: 1000, den: 1 });

function words(text: string, engine: Transcript['engine'] = 'tts'): Transcript {
  return {
    version: 1,
    language: 'en',
    engine,
    model: 'eleven_multilingual_v2',
    local: false,
    wordTiming: 'native',
    segments: [
      {
        text,
        range: TimeRange.of(ms(0), ms(900)),
        language: 'en',
        words: text.split(' ').map((word, i) => ({ text: word, range: TimeRange.of(ms(i * 300), ms(300)) })),
      },
    ],
  };
}

function line(text: string, transcript?: Transcript): GeneratedFile {
  return {
    bytes: new TextEncoder().encode(text),
    mediaType: 'audio/mpeg',
    fileName: `voice-line_${text.length}.mp3`,
    projectId: null,
    provenance: {
      kind: 'generated',
      generation: 'voice',
      provider: 'elevenlabs',
      model: 'eleven_multilingual_v2',
      access: 'api-key',
      quality: 'final',
      promptSha256: 'c'.repeat(64),
      voiceId: 'voice-1',
      providerRef: null,
      c2pa: 'absent',
      costUsd: 0.01,
      runId: null,
      createdAt: 1,
    },
    ...(transcript ? { transcript } : {}),
  };
}

describe('generated transcripts', () => {
  it("stores a voice line's words and language with its asset", async () => {
    const env = setup();
    const said = words('Welcome to Goa');
    const kept = unwrap(await env.sink.put(line('voice bytes', said)));
    expect(createTranscriptRepository(env.db).get(kept.assetId)).toEqual(said);
    expect(unwrap(createAssetRepository(env.db).get(kept.assetId)).language).toBe('en');
  });

  it('refuses a malformed transcript and keeps nothing', async () => {
    const env = setup();
    const bad: Transcript = { ...words('Welcome'), model: '' };
    const result = await env.sink.put(line('voice bytes', bad));
    expect(!result.ok && ValidationError.is(result.error) && result.error.params?.field).toBe('transcript');
    expect(row(env.db, 'SELECT count(*) AS n FROM assets')).toEqual({ n: 0 });
  });

  it("keeps the generator's words for the same bytes, and replaces recognised ones", async () => {
    const env = setup();
    const first = unwrap(await env.sink.put(line('voice bytes')));
    const transcripts = createTranscriptRepository(env.db);
    expect(transcripts.get(first.assetId)).toBeNull();
    unwrap(transcripts.put(first.assetId, words('Welcome to Gao', 'whisper'), 0));
    const said = words('Welcome to Goa');
    const again = unwrap(await env.sink.put(line('voice bytes', said)));
    expect(again).toMatchObject({ assetId: first.assetId, duplicate: true });
    expect(transcripts.get(first.assetId)).toEqual(said);
    unwrap(await env.sink.put(line('voice bytes', words('Something else'))));
    expect(transcripts.get(first.assetId)).toEqual(said);
  });

  it('skips the speech stages for it, also after a re-index, and still transcribes an imported clip', async () => {
    const env = setup();
    const events = createEventBus({ clock: { now: env.clock.now } });
    const stub = stubStages(env.db);
    const queue = createTestQueue(env.db, events, stub.handlers);
    const pipeline = createIndexingPipeline({
      db: env.db,
      queue,
      events,
      stages: stub.stages,
      log: () => {},
    });
    await pipeline.start({ poll: false });
    const said = words('Welcome to Goa');
    const voice = unwrap(await env.sink.put(line('voice bytes', said))).assetId;
    const imported = addAssets(env.db, ['audio']).assets[0]!;
    const rows = createStageRows(env.db);

    await runPipeline(pipeline, queue);
    expect(rows.get(voice, 'audio.transcript')).toMatchObject({
      state: 'skipped',
      reasonKey: TRANSCRIPT_PROVIDED,
    });
    expect(stub.runs.get(`${KINDS.transcript.kind} ${voice}`)).toBeUndefined();
    expect(stub.runs.get(`${KINDS.transcript.kind} ${imported}`)).toBe(1);
    expect(rows.get(voice, 'vision.embed')?.state).toBe('done');

    rows.reset([voice]);
    await runPipeline(pipeline, queue);
    expect(rows.get(voice, 'audio.transcript')).toMatchObject({
      state: 'skipped',
      reasonKey: TRANSCRIPT_PROVIDED,
    });
    expect(stub.runs.get(`${KINDS.transcript.kind} ${voice}`)).toBeUndefined();
    expect(createTranscriptRepository(env.db).get(voice)).toEqual(said);
    pipeline.stop();
  });
});
