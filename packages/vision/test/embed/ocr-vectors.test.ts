// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame vectors (`vision.embed`) and on-screen text vectors (`vision.embedOcr`, IX-O5) come from separate stages that
 * wait for neither each other, so the pipeline may run them in either order and re-run either alone. Each replaces
 * only its own kind: the jobs here are the stages' own, built from one asset view. Real FFmpeg, the fake model.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDirectJobRunner,
  FrameRate,
  newId,
  RationalTime,
  TimeRange,
  type AssetIndexView,
  type ShotId,
} from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmbedder } from '../../src/embed/embedder';
import { EMBEDDING_SPACE } from '../../src/embed/space';
import { createVisionIndexStages } from '../../src/jobs/stages';
import { createVisionJobs } from '../../src/jobs/vision-jobs';
import { fakeLoader } from '../helpers/fake-model';
import { makeReel, testMedia } from '../helpers/reel';
import { fakeAnalysis, fakeText } from '../helpers/shot-analysis';
import { memoryVectorIndex } from '../helpers/vector-index';

const { ctx, skip } = await testMedia('frame and on-screen text vectors');
const rate = FrameRate.of(25);

describe.skipIf(!ctx)(`frame and on-screen text vectors, in either order ${skip}`, () => {
  let dir = '';
  let path = '';
  const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, 768);
  const embedder = createEmbedder({ modelDir: '/m', loader: fakeLoader() });
  const stages = createVisionIndexStages({
    tier: 'recommended',
    ocrLanguages: () => ['en'],
    placement: () => 'local',
  });
  const shotA = newId<'Shot'>() as ShotId;
  const shotB = newId<'Shot'>() as ShotId;

  function view(): AssetIndexView {
    const shot = (shotId: ShotId, start: number, texts: string[]) => {
      const range = TimeRange.of(RationalTime.of(start, rate), RationalTime.of(20, rate));
      const onScreenText = texts.map((text) => fakeText(text, range));
      return { shotId, range, analysis: fakeAnalysis(range, { bestFrame: 5, onScreenText }) };
    };
    return {
      assetId: newId<'Asset'>(),
      generation: 1,
      kind: 'video',
      path,
      contentHash: 'cd'.repeat(32),
      sizeBytes: 1,
      sourceId: newId<'Source'>(),
      capturedAt: null,
      facts: null,
      derived: [],
      shots: [shot(shotA, 0, ['SALE 50%']), shot(shotB, 20, [])],
      transcript: null,
      outputs: {},
    };
  }

  /** Runs one stage's job for the asset, as the pipeline would queue it. */
  async function runStage(name: 'vision.embed' | 'vision.embedOcr', asset: AssetIndexView) {
    if (!ctx) throw new Error('no media');
    const stage = stages.find((s) => s.stage === name);
    if (!stage) throw new Error(`no stage ${name}`);
    const job = stage.job(asset);
    if ('skip' in job) throw new Error(`${name} skipped: ${job.skip}`);
    const jobs = createDirectJobRunner(
      createVisionJobs({ media: ctx, tier: 'recommended', tempDir: dir, embedder, index }),
    );
    const result = await jobs.run(job.kind, job.input);
    expect(result.ok).toBe(true);
  }

  const kinds = () => {
    const ids = [...index.rows.keys()];
    return {
      frames: ids.filter((id) => id.startsWith('frame:')).length,
      ocr: ids.filter((id) => id.startsWith('ocr:')).sort(),
    };
  };

  beforeAll(async () => {
    if (!ctx) return;
    dir = await mkdtemp(join(tmpdir(), 'taalcut-ocr-vectors-'));
    path = join(dir, 'clip.mp4');
    await makeReel(
      ctx,
      path,
      [
        { source: 'color=c=red', frames: 20 },
        { source: 'color=c=blue', frames: 20 },
      ],
      { width: 320, height: 180, rate: '25' },
    );
  }, 120_000);
  afterAll(async () => {
    await embedder.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ['vision.embed', 'vision.embedOcr'],
    ['vision.embedOcr', 'vision.embed'],
  ] as const)(
    'keeps both kinds after %s then %s, and after the first runs again',
    async (first, second) => {
      index.rows.clear();
      const asset = view();
      await runStage(first, asset);
      await runStage(second, asset);
      const both = kinds();
      expect(both.frames).toBeGreaterThan(0);
      expect(both.ocr).toEqual([`ocr:${shotA}:0`]);
      // A re-run of either (a version bump, a re-read) replaces only its own kind.
      await runStage(first, asset);
      expect(kinds()).toEqual(both);
    },
    120_000,
  );
});
