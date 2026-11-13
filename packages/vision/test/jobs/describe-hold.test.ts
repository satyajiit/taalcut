// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A description on this Mac whose runtime isn't ready (LIB1-FIX). The agent answers `models.local_runtime_unavailable`
 * while the runtime is paused for an export or still starting; stored as `not_yet`, the stage was done and the shots
 * were never described. With the describing model's component named, the job fails as `vision.model_missing`, which
 * the library holds and tries again by itself. A cloud description, or a process that names no component, keeps
 * `not_yet` as before.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDirectJobRunner,
  err,
  FrameRate,
  ok,
  type BackgroundModelResult,
  type BackgroundModels,
} from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { visionDescribeShotsCloudJob, visionDescribeShotsJob } from '../../src/jobs/index-kinds';
import { createVisionJobs } from '../../src/jobs/vision-jobs';
import { makeReel, testMedia } from '../helpers/reel';

const { ctx } = await testMedia('describe hold');

const unavailable: BackgroundModels = {
  complete: async () =>
    err({
      code: 'models.local_runtime_unavailable',
      messageKey: 'errors.models.local_runtime_unavailable',
      retryable: false,
      params: { state: 'paused' },
    }),
};

const answered: BackgroundModels = {
  complete: async () =>
    ok({
      status: 'answered',
      text: JSON.stringify({ description: 'Men dance on a stage.', objects: ['stage'], people: 4 }),
      provider: 'on-device',
      model: 'qwen3.5-4b',
      local: true,
      costUsd: 0,
      uploadedTo: [],
    } satisfies BackgroundModelResult),
};

describe.skipIf(!ctx)('a description whose on-device runtime is not ready', () => {
  let dir: string;
  let path: string;
  const rate = FrameRate.of(30);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-describe-hold-'));
    path = join(dir, 'clip.mp4');
    await makeReel(ctx!, path, [{ source: 'testsrc2', frames: 30 }], { width: 640, height: 360, rate: '30' });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const input = () => ({ assetId: 'a1', path, rate, shots: [{ shotId: 's1', frame: 3 }] });
  const jobs = (background: BackgroundModels, describeComponent?: string) =>
    createDirectJobRunner(
      createVisionJobs({
        media: ctx!,
        tier: 'recommended',
        tempDir: dir,
        background,
        ...(describeComponent ? { describeComponent } : {}),
      }),
    );

  it('fails as vision.model_missing naming the describing model, so the library holds it', async () => {
    const described = await jobs(unavailable, 'local-llm-qwen3-5-4b').run(visionDescribeShotsJob, input());
    expect(described.ok).toBe(false);
    if (described.ok) return;
    expect(described.error.code).toBe('vision.model_missing');
    expect(described.error.params).toEqual({ component: 'local-llm-qwen3-5-4b' });
  });

  it('keeps not_yet where no component is named, or the description goes to the cloud', async () => {
    const local = await jobs(unavailable).run(visionDescribeShotsJob, input());
    expect(local.ok && local.value.skipped).toBe('not_yet');
    const cloud = await jobs(unavailable, 'local-llm-qwen3-5-4b').run(visionDescribeShotsCloudJob, input());
    expect(cloud.ok && cloud.value.skipped).toBe('not_yet');
  });

  it('describes as before once the runtime answers', async () => {
    const described = await jobs(answered, 'local-llm-qwen3-5-4b').run(visionDescribeShotsJob, input());
    expect(described.ok && described.value.descriptions.map((d) => d.description.text)).toEqual([
      'Men dance on a stage.',
    ]);
    expect(described.ok && described.value.skipped).toBeUndefined();
  });
});
