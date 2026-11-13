// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Media job kinds, their handlers and the direct (in-process) JobRunner, without FFmpeg. */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defineJobKind,
  jobKindSchema,
  jobRequestSchema,
  ok,
  type JobProgress,
  type ProjectId,
} from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createDirectJobRunner,
  createMediaJobs,
  forwardJobProgress,
  MEDIA_JOB_STAGES,
  mediaExtractFrameJob,
  mediaJobKinds,
  mediaProbeJob,
  mediaSelectEncoderJob,
  parseProbeJson,
  probeResultSchema,
  registerJob,
  type ExtractFrameOptions,
  type MediaJobDeps,
  type RationalTime,
} from '@taalcut/media';
import { pngHeader } from './helpers/probe-fixture';

const iphone = parseProbeJson(
  '/Volumes/Trip/IMG_0420.MOV',
  readFileSync(new URL('./fixtures/iphone-hdr-portrait.ffprobe.json', import.meta.url), 'utf8'),
);
if (!iphone.ok) throw new Error('fixture did not parse');
const probeResult = iphone.value;

/** A MediaService stand-in that records what each handler asked for. */
function fakeMedia() {
  const calls: { method: string; args: unknown[] }[] = [];
  const media: MediaJobDeps = {
    probe: async (...args) => {
      calls.push({ method: 'probe', args });
      return ok(probeResult);
    },
    extractFrame: async (path: string, at: RationalTime, options?: ExtractFrameOptions) => {
      calls.push({ method: 'extractFrame', args: [path, at, options] });
      return ok({
        data: pngHeader(120, 160),
        mimeType: 'image/png' as const,
        width: 120,
        height: 160,
        at,
        backend: 'software' as const,
        fallbackReason: { code: 'hardware_failed' as const, detail: 'hwaccel initialisation returned error' },
      });
    },
    selectEncoder: async (...args) => {
      calls.push({ method: 'selectEncoder', args });
      return ok({ codec: 'h264' as const, encoder: 'h264_videotoolbox', backend: 'videotoolbox' as const });
    },
  };
  return { media, calls };
}

describe('media job kinds', () => {
  it("follow core's contract: names, resource classes, priorities", () => {
    for (const kind of mediaJobKinds) expect(jobKindSchema.safeParse(kind.kind).success).toBe(true);
    expect(mediaJobKinds.map((k) => [k.kind, k.resource, k.priority])).toEqual([
      ['media.probe', 'io', 'high'],
      ['media.extractFrame', 'video', 'high'],
      ['media.selectEncoder', 'video', 'normal'],
      ['media.normalise', 'video', 'low'],
      ['media.makeProxy', 'video', 'low'],
      ['media.makePreviews', 'video', 'low'],
      ['media.makeFilmstrip', 'video', 'low'],
      ['media.makeThumbnail', 'video', 'low'],
      ['media.conform', 'video', 'normal'],
      ['media.enforceCacheCap', 'io', 'low'],
    ]);
    expect(mediaSelectEncoderJob.idempotencyKey).toBeUndefined();
  });

  describe('idempotency keys', () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'taalcut-jobs-'));
    });
    afterAll(() => rm(dir, { recursive: true, force: true }));

    it('follow the file and the options, fit the queue, and keep the path out', async () => {
      const path = join(dir, 'x'.repeat(200), 'clip.mov');
      await writeFile(join(dir, 'clip.mov'), 'one');
      const at = { value: 1, rate: 2 };
      const probeKey = mediaProbeJob.idempotencyKey?.({ path }) ?? '';
      expect(
        jobRequestSchema.safeParse({ kind: 'media.probe', input: {}, idempotencyKey: probeKey }).success,
      ).toBe(true);
      expect(probeKey).toMatch(/^media\.probe:[0-9a-f]{64}$/);
      const frameKey = (extra: object = {}) =>
        mediaExtractFrameJob.idempotencyKey?.({ path: join(dir, 'clip.mov'), at, ...extra });
      expect(frameKey()).toBe(frameKey());
      expect(frameKey({ maxDimension: 512 })).not.toBe(frameKey());
      expect(frameKey({ decode: 'software' })).not.toBe(frameKey());
      const before = frameKey();
      await writeFile(join(dir, 'clip.mov'), 'edited');
      expect(frameKey()).not.toBe(before);
      expect(frameKey()).not.toContain('clip.mov');
    });
  });

  it('probeResultSchema accepts a stored ProbeResult and rejects a wrong one', () => {
    const stored: unknown = JSON.parse(JSON.stringify(probeResult));
    expect(probeResultSchema.parse(stored)).toEqual(stored);
    expect(probeResultSchema.safeParse({ ...probeResult, streams: [{ kind: 'video' }] }).success).toBe(false);
  });
});

describe('media job handlers through the direct runner', () => {
  it('media.probe: probes with the job signal, reports its stage, returns a valid ProbeResult', async () => {
    const { media, calls } = fakeMedia();
    const runner = createDirectJobRunner(createMediaJobs(media));
    const progress: JobProgress[] = [];
    const controller = new AbortController();
    const result = await runner.run(
      mediaProbeJob,
      { path: '/a.mov' },
      { signal: controller.signal, onProgress: (p) => progress.push(p) },
    );
    expect(result.ok && result.value.video?.codec).toBe('hevc');
    expect(calls).toEqual([{ method: 'probe', args: ['/a.mov', { signal: controller.signal }] }]);
    expect(progress).toEqual([{ fraction: 0, stageKey: MEDIA_JOB_STAGES.probing }, { fraction: 1 }]);
  });

  it('media.extractFrame: the image as base64, with the backend and the fallback reason', async () => {
    const { media, calls } = fakeMedia();
    const runner = createDirectJobRunner(createMediaJobs(media));
    const at = { value: 1, rate: 2 };
    const result = await runner.run(mediaExtractFrameJob, {
      path: '/a.mov',
      at,
      format: 'png',
      maxDimension: 160,
    });
    expect(result.ok && result.value).toEqual({
      dataBase64: pngHeader(120, 160).toString('base64'),
      mimeType: 'image/png',
      width: 120,
      height: 160,
      at,
      backend: 'software',
      fallbackReason: { code: 'hardware_failed', detail: 'hwaccel initialisation returned error' },
    });
    expect(calls[0]?.args[2]).toMatchObject({ format: 'png', maxDimension: 160, maxBytes: 8 * 1024 * 1024 });
  });

  it('media.selectEncoder: the trial-encoded choice', async () => {
    const { media, calls } = fakeMedia();
    const result = await createDirectJobRunner(createMediaJobs(media)).run(mediaSelectEncoderJob, {
      codec: 'h264',
    });
    expect(result.ok && result.value).toEqual({
      codec: 'h264',
      encoder: 'h264_videotoolbox',
      backend: 'videotoolbox',
    });
    expect(calls[0]?.args[0]).toBe('h264');
  });
});

describe('createDirectJobRunner', () => {
  const echo = defineJobKind({
    kind: 'test.echo',
    input: z.object({ n: z.int() }),
    output: z.object({ n: z.int() }),
    resource: 'cpu',
  });

  it('validates the input before the handler runs', async () => {
    let ran = false;
    const runner = createDirectJobRunner([
      registerJob(echo, async (input) => {
        ran = true;
        return ok(input);
      }),
    ]);
    const result = await runner.run(echo, { n: 1.5 });
    expect(!result.ok && result.error).toMatchObject({ code: 'core.validation', params: { field: 'input' } });
    expect(ran).toBe(false);
  });

  it('stores the output as JSON would: what does not survive fails here as it would in the queue', async () => {
    const bufferKind = defineJobKind({
      kind: 'test.buffer',
      input: z.object({}),
      output: z.object({ data: z.string() }),
      resource: 'cpu',
    });
    const runner = createDirectJobRunner([
      registerJob(bufferKind, async () => ok({ data: Buffer.from('x') as unknown as string })),
    ]);
    const result = await runner.run(bufferKind, {});
    expect(!result.ok && result.error).toMatchObject({
      code: 'core.validation',
      params: { field: 'output' },
    });
  });

  it('passes the project, signal and progress; refuses unknown kinds and pre-aborted runs', async () => {
    const seen: unknown[] = [];
    const runner = createDirectJobRunner([
      registerJob(echo, async (input, context) => {
        seen.push(context.projectId, context.attempt, context.signal.aborted);
        context.progress({ fraction: 0.5 });
        return ok(input);
      }),
    ]);
    const progress: JobProgress[] = [];
    const projectId = 'project_1' as ProjectId;
    expect(await runner.run(echo, { n: 2 }, { projectId, onProgress: (p) => progress.push(p) })).toEqual(
      ok({ n: 2 }),
    );
    expect(seen).toEqual([projectId, 1, false]);
    expect(progress).toEqual([{ fraction: 0.5 }]);

    const other = defineJobKind({ ...echo, kind: 'test.other' });
    expect(await runner.run(other, { n: 1 })).toMatchObject({ ok: false, error: { code: 'core.not_found' } });
    const aborted = AbortSignal.abort();
    expect(await runner.run(echo, { n: 1 }, { signal: aborted })).toMatchObject({
      ok: false,
      error: { code: 'core.cancelled' },
    });
  });
});

describe('forwardJobProgress', () => {
  it('maps the fraction onto a span, keeps the last value when unknown, and names the stage', () => {
    const seen: [number, string | undefined][] = [];
    const forward = forwardJobProgress((f, note) => seen.push([f, note]), {
      notes: { 'jobs.stage.x': 'doing x' },
      from: 0,
      to: 0.3,
    });
    forward({ fraction: null, stageKey: 'jobs.stage.x' });
    forward({ fraction: 0.5 });
    forward({ fraction: null, stageKey: 'jobs.stage.unknown' });
    forward({ fraction: 1 });
    expect(seen).toEqual([
      [0, 'doing x'],
      [0.15, undefined],
      [0.15, 'jobs.stage.unknown'],
      [0.3, undefined],
    ]);
  });
});
