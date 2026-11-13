// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Optional reads (LRN1-CTX, core `optionalReads`): a stage shaped like vision.describe reads the transcript when it
 * can have it, and never stalls on it when it can't. It waits for a transcript that is coming and runs once; it
 * runs past one that waits for its model (the held row and the rows blocked behind it alike), failed, or whose own
 * need waits for its model; it runs again once such a transcript lands, after an install or Try again.
 */
import {
  createEventBus,
  defineError,
  defineIndexStage,
  defineJobKind,
  err,
  NO_RETRY,
  ok,
  stageJob,
  ValidationError,
  type AssetId,
  type IndexStageDefinition,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  checkStageReads,
  createIndexingPipeline,
  createStageRows,
  MODEL_MISSING,
  stagePlan,
} from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { KINDS, stubStages } from './stages';

const SpeechModelMissing = defineError<{ component: string }>('test.model_missing');
const kind = (name: string) =>
  defineJobKind({ kind: name, input: z.any(), output: z.any(), resource: 'cpu', retry: NO_RETRY });
const LANGUAGE = kind('test.identifyLanguage');
const DESCRIBE = kind('test.describe');

/** What a stand-in model can do, and what it did: a describe run per asset, with what it read as said. */
interface World {
  language: 'ok' | 'missing';
  transcript: 'ok' | 'missing' | 'broken';
  readonly said: Map<AssetId, (string | null)[]>;
}

function graph(stub: ReturnType<typeof stubStages>): IndexStageDefinition[] {
  const language = defineIndexStage({
    stage: 'audio.language',
    version: 1,
    stores: (view) => view.outputs['audio.language'] ?? null,
    needs: ['media.normalise'],
    appliesTo: ['video', 'audio'],
    priority: 'normal',
    job: (view) => stageJob(LANGUAGE, { assetId: view.assetId }),
    result: () => ok({ language: 'en' }),
  });
  const describeStage = defineIndexStage({
    stage: 'vision.describe',
    version: 1,
    needs: ['vision.analyse'],
    optionalReads: ['audio.transcript'],
    appliesTo: ['video', 'image'],
    priority: 'low',
    milestone: 'complete',
    job: (view) =>
      stageJob(DESCRIBE, {
        assetId: view.assetId,
        said: view.transcript?.segments.map((segment) => segment.text).join(' ') ?? null,
      }),
    result: () => ok({}),
  });
  const stages = stub.stages
    .filter((stage) => stage.stage !== 'vision.embed')
    .map((stage) =>
      stage.stage === 'audio.transcript'
        ? { ...stage, needs: ['audio.language'], stores: (view: { transcript: unknown }) => view.transcript }
        : stage,
    );
  return [...stages, language, describeStage];
}

async function setup(world: World) {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const events = createEventBus({ clock: { now: clock.now } });
  const stub = stubStages(db);
  const transcribe = stub.handlers[KINDS.transcript.kind];
  if (!transcribe) throw new Error('no transcript stub');
  stub.handlers[KINDS.transcript.kind] = (input, jobId) =>
    world.transcript === 'ok'
      ? transcribe(input, jobId)
      : Promise.resolve(
          world.transcript === 'missing'
            ? err(SpeechModelMissing({ component: 'whisper-medium' }))
            : err(ValidationError({ field: 'audio' })),
        );
  stub.handlers[LANGUAGE.kind] = async () =>
    world.language === 'ok' ? ok({}) : err(SpeechModelMissing({ component: 'whisper-tiny' }));
  stub.handlers[DESCRIBE.kind] = async (input) => {
    const { assetId, said } = input as { assetId: AssetId; said: string | null };
    world.said.set(assetId, [...(world.said.get(assetId) ?? []), said]);
    return ok({});
  };
  const queue = createTestQueue(db, events, stub.handlers);
  const pipeline = createIndexingPipeline({ db, queue, events, stages: graph(stub), log: () => {} });
  await pipeline.start({ poll: false });
  return { db, pipeline, rows: createStageRows(db), run: () => runPipeline(pipeline, queue) };
}

const newWorld = (over: Partial<Omit<World, 'said'>> = {}): World => ({
  language: 'ok',
  transcript: 'ok',
  said: new Map(),
  ...over,
});

describe('an optional read', () => {
  it('is waited for while it is coming: one describe run per clip, with what is said', async () => {
    const world = newWorld();
    const t = await setup(world);
    const { assets } = addAssets(t.db, ['video', 'video', 'image']);
    await t.run();
    const [first, second, photo] = assets as [AssetId, AssetId, AssetId];
    expect(world.said.get(first)).toEqual(['hello there']);
    expect(world.said.get(second)).toEqual(['hello there']);
    // A photo has no transcript to wait for.
    expect(world.said.get(photo)).toEqual([null]);
  });

  it('is not waited for while its model is missing, on every clip, and runs again once it lands', async () => {
    const world = newWorld({ transcript: 'missing' });
    const t = await setup(world);
    const first = addAssets(t.db, ['video', 'video']).assets;
    await t.run();
    // Clips imported while the stage waits for its model are never tried: their rows wait behind the held ones,
    // with the reason and no error (not held themselves), and describe doesn't wait for them either.
    const later = addAssets(t.db, ['video'], { sourceName: 'Later' }).assets;
    await t.run();
    const assets = [...first, ...later];
    for (const id of assets) {
      expect(t.rows.get(id, 'audio.transcript')).toMatchObject({
        state: 'waiting',
        reasonKey: MODEL_MISSING,
      });
      expect(t.rows.get(id, 'vision.describe')?.state).toBe('done');
      expect(world.said.get(id)).toEqual([null]);
    }
    expect(later.map((id) => t.rows.get(id, 'audio.transcript')?.error)).toEqual([null]);

    world.transcript = 'ok';
    await t.pipeline.modelsInstalled();
    await t.run();
    for (const id of assets) {
      expect(t.rows.get(id, 'audio.transcript')?.state).toBe('done');
      expect(world.said.get(id)).toEqual([null, 'hello there']);
    }
  });

  it('is waited for again as soon as Try again releases it, on the rows blocked behind the held one too', async () => {
    const world = newWorld({ transcript: 'missing' });
    const t = await setup(world);
    const first = addAssets(t.db, ['video']).assets;
    await t.run();
    const later = addAssets(t.db, ['video'], { sourceName: 'Later' }).assets;
    await t.run();
    const assets = [...first, ...later];
    expect(assets.map((id) => t.rows.get(id, 'audio.transcript')?.error === null)).toEqual([false, true]);

    world.transcript = 'ok';
    expect(t.rows.retryFailed()).toBe(2);
    // Plain waiting, both: the transcript is coming again, so a describe that waits now waits for it.
    for (const id of assets)
      expect(t.rows.get(id, 'audio.transcript')).toMatchObject({ state: 'waiting', reasonKey: null });
    await t.run();
    for (const id of assets) expect(world.said.get(id)).toEqual([null, 'hello there']);
  });

  it('is not waited for once it failed, and a later store runs the reader again', async () => {
    const world = newWorld({ transcript: 'broken' });
    const t = await setup(world);
    const { sourceId, assets } = addAssets(t.db, ['video']);
    const [id] = assets as [AssetId];
    await t.run();
    expect(t.rows.get(id, 'audio.transcript')?.state).toBe('failed');
    expect(world.said.get(id)).toEqual([null]);

    world.transcript = 'ok';
    await t.pipeline.retryFailed(sourceId);
    await t.run();
    expect(world.said.get(id)).toEqual([null, 'hello there']);
  });

  it('is not waited for when a stage it needs waits for its model', async () => {
    const world = newWorld({ language: 'missing' });
    const t = await setup(world);
    const { assets } = addAssets(t.db, ['video']);
    const [id] = assets as [AssetId];
    await t.run();
    expect(t.rows.get(id, 'audio.language')).toMatchObject({ state: 'waiting', reasonKey: MODEL_MISSING });
    // The transcript itself is plain waiting (its need isn't met); describe ran without it.
    expect(t.rows.get(id, 'audio.transcript')).toMatchObject({ state: 'waiting', reasonKey: null });
    expect(world.said.get(id)).toEqual([null]);
  });
});

describe('the optional read graph', () => {
  const stages = () => graph(stubStages(openTestDb({ file: false })));

  it('plans each read with the kinds it applies to and everything that can block it', () => {
    const all = stages();
    const describeStage = all.find((stage) => stage.stage === 'vision.describe');
    if (!describeStage) throw new Error('no describe stage');
    expect(stagePlan(describeStage, all).optionalReads).toEqual([
      {
        stage: 'audio.transcript',
        appliesTo: ['video'],
        blockers: ['audio.transcript', 'audio.language', 'media.normalise', 'library.hash'],
      },
    ]);
  });

  it('throws on an optional read that stores nothing, or a searchable stage reading a complete one', () => {
    const all = stages();
    const bare = all.map((stage) =>
      stage.stage === 'audio.transcript' ? { ...stage, stores: undefined } : stage,
    );
    expect(() => checkStageReads(bare)).toThrow(/'audio.transcript' is read by 'vision.describe'/);
    const promoted = new Set(['vision.describe', 'audio.transcript']);
    const searchable = all.map((stage) =>
      promoted.has(stage.stage) ? { ...stage, milestone: 'searchable' as const } : stage,
    );
    expect(() => checkStageReads(searchable)).not.toThrow();
    const late = searchable.map((stage) =>
      stage.stage === 'audio.transcript' ? { ...stage, milestone: 'complete' as const } : stage,
    );
    expect(() => checkStageReads(late)).toThrow(
      /Searchable index stage 'vision.describe' reads 'audio.transcript'/,
    );
  });
});
