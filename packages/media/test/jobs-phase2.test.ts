// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Phase 2 job kinds through the direct runner. Handlers do not call FFmpeg. */
import { derivedFileRefSchema, ok, RationalTime, type JobProgress } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createDirectJobRunner,
  createMediaJobs,
  mediaConformJob,
  mediaEnforceCacheCapJob,
  mediaMakeFilmstripJob,
  mediaMakePreviewsJob,
  mediaMakeProxyJob,
  mediaNormaliseJob,
  normalisationPlanSchema,
  type MediaJobDeps,
} from '@taalcut/media';
import { videoPlan } from './helpers/video-plan';

const HASH = 'ab'.repeat(32);

function ref(kind: 'thumbnail' | 'filmstrip' | 'conformed' | 'waveform', ext: 'jpg' | 'bin' | 'mp4', mime: 'image/jpeg' | 'application/octet-stream' | 'video/mp4') {
  const dir = { thumbnail: 'thumbnails', filmstrip: 'filmstrips', conformed: 'conformed', waveform: 'waveforms' }[kind];
  return derivedFileRefSchema.parse({
    kind,
    key: `${dir}/ab/${HASH}.v1.${ext}`,
    bytes: 32,
    mimeType: mime,
    recipe: 1,
  });
}

function phase2(): MediaJobDeps {
  const plan = videoPlan();
  return {
    probe: async () => ok({ path: '/a.mov', container: { formatName: 'mov' }, streams: [], chapters: [], tags: {} }),
    extractFrame: async () =>
      ok({ data: Buffer.alloc(0), mimeType: 'image/jpeg' as const, width: 1, height: 1, at: { value: 0, rate: 1 }, backend: 'software' as const }),
    selectEncoder: async () => ok({ codec: 'h264', encoder: 'h264_videotoolbox', backend: 'videotoolbox' }),
    normalise: async () => ok({ plan, facts: plan.facts }),
    makeProxy: async () => ok({ reusedOriginal: true, ratio: 1, overBudget: false, warnings: [] }),
    makePreviews: async () => ok({ waveform: ref('waveform', 'bin', 'application/octet-stream') }),
    makeFilmstrip: async () =>
      ok({
        filmstrip: {
          file: ref('filmstrip', 'jpg', 'image/jpeg'),
          columns: 2,
          rows: 1,
          tileWidth: 108,
          tileHeight: 192,
          times: [RationalTime.of(0, { num: 30, den: 1 }), RationalTime.of(59, { num: 30, den: 1 })],
        },
        source: 'exact' as const,
      }),
    makeThumbnail: async () => ok({ thumbnail: ref('thumbnail', 'jpg', 'image/jpeg') }),
    conform: async () => ok({ file: ref('conformed', 'mp4', 'video/mp4'), driftMs: 0 }),
    enforceCacheCap: async () => ok({ evicted: [], freedBytes: 0, usageBytes: 0 }),
  };
}

describe('phase 2 job kinds', () => {
  const plan = videoPlan();

  it('round-trips a plan through the job schema', () => {
    expect(normalisationPlanSchema.parse(JSON.parse(JSON.stringify(plan)))).toMatchObject({ kind: 'video', frames: 60 });
  });

  it('uses literal idempotency keys and keeps enforceCacheCap unkeyed', () => {
    const input = { path: '/clip.mp4', contentHash: HASH, sizeBytes: 10 };
    expect(mediaNormaliseJob.idempotencyKey?.(input)).toBe(`normalise:v1:${HASH}`);
    expect(mediaMakeProxyJob.idempotencyKey?.({ ...input, plan })).toBe(`proxy:v1:${HASH}`);
    expect(mediaMakePreviewsJob.idempotencyKey?.({ path: input.path, contentHash: HASH, plan })).toBe(`previews:v2:${HASH}`);
    expect(mediaMakeFilmstripJob.idempotencyKey?.({ path: input.path, contentHash: HASH, plan })).toBe(`filmstrip:v2:${HASH}`);
    expect(mediaConformJob.idempotencyKey?.({ ...input, plan, codec: 'h264' })).toBe(`conform:v1:${HASH}:all:full:h264`);
    expect(mediaEnforceCacheCapJob.idempotencyKey).toBeUndefined();
    expect(mediaMakeProxyJob.resource).toBe('video');
    expect(mediaMakeProxyJob.timeoutMs).toBe(60 * 60 * 1000);
    expect(mediaConformJob.timeoutMs).toBe(120 * 60 * 1000);
    expect(mediaEnforceCacheCapJob.retry.maxAttempts).toBe(1);
  });

  it('runs normalise and enforce through the direct runner', async () => {
    const runner = createDirectJobRunner(createMediaJobs(phase2()));
    const progress: JobProgress[] = [];
    const normalised = await runner.run(
      mediaNormaliseJob,
      { path: '/clip.mp4', contentHash: HASH, sizeBytes: 10 },
      { onProgress: (event) => progress.push(event) },
    );
    expect(normalised.ok && normalised.value.facts.frameRate).toBeDefined();
    expect(progress[0]).toMatchObject({ fraction: 0 });
    const capped = await runner.run(mediaEnforceCacheCapJob, { capBytes: 1000, offlineHashes: [], pinned: [] });
    expect(capped.ok && capped.value).toEqual({ evicted: [], freedBytes: 0, usageBytes: 0 });
  });

  it('runs the filmstrip as its own job, saying so, and hands back the sprite with its frames’ times', async () => {
    const runner = createDirectJobRunner(createMediaJobs(phase2()));
    const progress: JobProgress[] = [];
    const strip = await runner.run(
      mediaMakeFilmstripJob,
      { path: '/clip.mp4', contentHash: HASH, plan },
      { onProgress: (event) => progress.push(event) },
    );
    expect(progress[0]).toMatchObject({ fraction: 0, stageKey: 'jobs.stage.makingFilmstrip' });
    expect(strip.ok && strip.value.filmstrip.times).toHaveLength(2);
    expect(strip.ok && strip.value.decodes).toBeDefined();
    const previews = await runner.run(mediaMakePreviewsJob, { path: '/clip.mp4', contentHash: HASH, plan });
    expect(previews.ok && Object.keys(previews.value).sort()).toEqual(['decodes', 'waveform']);
  });
});
