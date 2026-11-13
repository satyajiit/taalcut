// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing job kinds through a direct runner on a synthetic reel: shots,
 * then analysis, then embeddings (a fake model), then descriptions (none in
 * the jobs process yet: `not_yet`), then duplicates. And the lazy
 * registrations the desktop uses: a failed resolve fails that job with its
 * reason and is tried again next time; a good one is kept.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDirectJobRunner,
  err,
  FrameRate,
  ok,
  RationalTime,
  ValidationError,
  type Result,
} from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEmbedder } from '../src/embed/embedder';
import { EMBEDDING_SPACE } from '../src/embed/space';
import type { VisionJobDeps } from '../src/jobs/deps';
import {
  indexJobKinds,
  visionAnalyzeShotsJob,
  visionDescribeShotsJob,
  visionDetectShotsJob,
  visionEmbedAssetJob,
  visionGroupDuplicatesJob,
} from '../src/jobs/index-kinds';
import { createLazyVisionJobs, createVisionJobs, visionJobKinds } from '../src/jobs/vision-jobs';
import { framesForShot } from '../src/jobs/embed-stages';
import { describeFramesForShot } from '../src/jobs/stages';
import { fakeLoader } from './helpers/fake-model';
import { makeReel, testMedia } from './helpers/reel';
import { memoryVectorIndex } from './helpers/vector-index';

const { ctx, skip } = await testMedia('vision jobs');

describe('kinds', () => {
  it('are unique, take plain JSON, and are registered once each', () => {
    const names = visionJobKinds.map((kind) => kind.kind);
    expect(new Set(names).size).toBe(names.length);
    expect(names.slice(0, indexJobKinds.length)).toEqual(indexJobKinds.map((kind) => kind.kind));
    // Outputs use core's time schemas, which reduce rates and ranges (a transform): inputs only here.
    for (const kind of indexJobKinds) {
      expect(() => z.toJSONSchema(kind.input, { unrepresentable: 'throw', io: 'input' })).not.toThrow();
    }
    const registered = createVisionJobs({ media: { binaries: {} as never }, tier: 'minimum', tempDir: '/t' });
    expect(registered.map((r) => r.kind.kind)).toEqual(names);
  });
});

describe('framesForShot', () => {
  const rate = FrameRate.of(30);
  const range = (start: number, frames: number) => ({
    start: RationalTime.of(start, rate),
    duration: RationalTime.of(frames, rate),
  });

  it('puts the best frame first, then spreads extras by tier', () => {
    expect(framesForShot(range(100, 300), 250, 'minimum')).toEqual([350]);
    // 10 s on Recommended: 1 + floor(10 / 4) = 3 frames.
    const recommended = framesForShot(range(100, 300), 250, 'recommended');
    expect(recommended).toHaveLength(3);
    expect(recommended[0]).toBe(350);
    expect(recommended.slice(1)).toEqual([...recommended.slice(1)].sort((a, b) => a - b));
    // 10 s on High: 1 + floor(10 / 2) = 6 frames, none closer than the spacing allows.
    const high = framesForShot(range(0, 300), 10, 'high');
    expect(high[0]).toBe(10);
    expect(high).toHaveLength(6);
    expect(new Set(high).size).toBe(6);
    // A 2-frame shot never asks for more frames than it has.
    expect(framesForShot(range(0, 2), 5, 'high')).toEqual([1]);
  });

  it('samples chronological frames across longer shots for describeFramesForShot, keeping start, best, and end', () => {
    expect(describeFramesForShot(range(0, 30), 5, rate)).toEqual([5]);
    const medium = describeFramesForShot(range(0, 120), 0, rate);
    expect(medium).toEqual([0, 60, 105]);
    const long = describeFramesForShot(range(0, 600), 120, rate);
    expect(long).toEqual([60, 120, 383, 539]);
  });
});

describe('lazy registrations', () => {
  it('fail a job with the resolver error, try again next time, then keep the deps', async () => {
    let calls = 0;
    const jobs = createLazyVisionJobs(async (): Promise<Result<VisionJobDeps>> => {
      calls++;
      if (calls === 1) return err(ValidationError({ field: 'ffmpeg' }, { detail: 'not yet' }));
      return ok({ media: { binaries: {} as never }, tier: 'minimum', tempDir: '/t' });
    });
    const runner = createDirectJobRunner(jobs);
    const input = { shots: [] };
    const first = await runner.run(visionGroupDuplicatesJob, input);
    expect(!first.ok && first.error.code).toBe('core.validation');
    expect(await runner.run(visionGroupDuplicatesJob, input)).toEqual({ ok: true, value: { groups: [] } });
    await runner.run(visionGroupDuplicatesJob, input);
    expect(calls).toBe(2);
  });
});

describe.skipIf(!ctx)(`index jobs on a synthetic reel ${skip}`, () => {
  let dir = '';
  let path = '';
  const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, 768);
  const embedder = createEmbedder({ modelDir: '/m', loader: fakeLoader() });
  // Shots on scdet alone (the fake model's mean-colour vectors can't tell these patterns apart), then
  // embeddings with the fake model.
  const scdet = () => createDirectJobRunner(createVisionJobs({ media: ctx!, tier: 'minimum', tempDir: dir }));
  const withModel = () =>
    createDirectJobRunner(createVisionJobs({ media: ctx!, tier: 'minimum', tempDir: dir, embedder, index }));

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-vision-jobs-'));
    path = join(dir, 'reel.mp4');
    await makeReel(
      ctx!,
      path,
      [
        { source: 'testsrc2', frames: 30 },
        { source: 'smptehdbars', frames: 30 },
        { source: 'mandelbrot', frames: 30 },
      ],
      { width: 640, height: 360, rate: '30' },
    );
  }, 120_000);
  afterAll(async () => {
    await embedder.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('runs shots, analysis, embeddings, descriptions and duplicates in order', async () => {
    const jobs = scdet();
    const shots = await jobs.run(visionDetectShotsJob, { assetId: 'a1', path });
    expect(shots.ok).toBe(true);
    if (!shots.ok) return;
    expect(shots.value.cuts.map((c) => [c.frame, c.method])).toEqual([
      [30, 'scdet'],
      [60, 'scdet'],
    ]);
    expect([shots.value.detector, shots.value.frameCount]).toEqual(['scdet', 90]);
    expect(shots.value.shots).toHaveLength(3);

    const refs = shots.value.shots.map((range, i) => ({ shotId: `s${i}`, range }));
    const analysed = await jobs.run(visionAnalyzeShotsJob, {
      assetId: 'a1',
      path,
      shots: refs,
    });
    expect(analysed.ok).toBe(true);
    if (!analysed.ok) return;
    const analyses = analysed.value.shots;
    expect(analyses.map((s) => s.shotId)).toEqual(['s0', 's1', 's2']);
    for (const { analysis } of analyses) expect(analysis.dHash).toMatch(/^[0-9a-f]{16}$/);

    const frames = refs.map((ref, i) => ({
      shotId: ref.shotId,
      frames: framesForShot(ref.range, analyses[i]!.analysis.bestFrame, 'minimum'),
    }));
    const embedded = await withModel().run(visionEmbedAssetJob, {
      assetId: 'a1',
      sourceId: 'src',
      path,
      frames,
      texts: [],
    });
    expect(embedded.ok && embedded.value.frames).toBe(frames.reduce((n, f) => n + f.frames.length, 0));
    expect(index.rows.has('frame:s0:0')).toBe(true);

    const rate = shots.value.frameRate;
    const described = await jobs.run(visionDescribeShotsJob, {
      assetId: 'a1',
      path,
      rate,
      shots: analyses.map((s) => ({ shotId: s.shotId, frame: s.analysis.bestFrame })),
    });
    expect(described).toEqual({ ok: true, value: { descriptions: [], uploadedTo: [], skipped: 'not_yet' } });

    const groups = await jobs.run(visionGroupDuplicatesJob, {
      shots: analyses.map((s) => ({
        shotId: s.shotId,
        assetId: 'a1',
        sourceId: 'src',
        capturedAt: null,
        durationMs: 1000,
        overall: s.analysis.quality.overall,
        dHash: s.analysis.dHash,
        orientation: s.analysis.orientation,
      })),
    });
    // Three different test patterns: no near-duplicates.
    expect(groups).toEqual({ ok: true, value: { groups: [] } });
  }, 240_000);

  it('says why embedding cannot run without an embedder', async () => {
    const jobs = createDirectJobRunner(createVisionJobs({ media: ctx!, tier: 'minimum', tempDir: dir }));
    const result = await jobs.run(visionEmbedAssetJob, {
      assetId: 'a1',
      sourceId: 'src',
      path,
      frames: [],
      texts: [],
    });
    expect(!result.ok && result.error.code).toBe('vision.embedder_unavailable');
  });
});
