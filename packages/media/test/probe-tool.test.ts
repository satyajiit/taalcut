// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The `media.probe` agent tool: metadata, summary, artifact, errors, and its probe step as a job. */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, toolModuleProblems, toolNeedsApproval, type Result } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createDirectJobRunner,
  createMediaJobs,
  createProbeTool,
  fileFingerprint,
  MEDIA_JOB_STAGES,
  MediaFileNotFound,
  mediaToolModule,
  parseProbeJson,
  type MediaJobDeps,
  type ProbeResult,
} from '@taalcut/media';
import { fakeJobRunner } from './helpers/fake-jobs';
import { testToolContext } from './helpers/tool-context';

const iphoneJson = readFileSync(
  new URL('./fixtures/iphone-hdr-portrait.ffprobe.json', import.meta.url),
  'utf8',
);
const iphone = parseProbeJson('/Volumes/Trip/IMG_0420.MOV', iphoneJson);
if (!iphone.ok) throw new Error('fixture did not parse');
const probeResult: ProbeResult = iphone.value;

/** A job runner whose media.probe job reports half way, then answers `result`. */
const probeReturning = (result: Result<ProbeResult>) =>
  fakeJobRunner(() => result, [{ fraction: 0.5, stageKey: MEDIA_JOB_STAGES.probing }]);

describe('media.probe metadata', () => {
  const tool = createProbeTool({ jobs: probeReturning(ok(probeResult)) });

  it('passes the registry checks and is a local, cacheable read', () => {
    expect(toolModuleProblems(mediaToolModule({ jobs: probeReturning(ok(probeResult)) }))).toEqual([]);
    expect(tool).toMatchObject({
      name: 'media.probe',
      costClass: 'local',
      sideEffect: 'read',
      permission: { network: 'none' },
      cache: { ttlMs: 300_000 },
    });
    expect(toolNeedsApproval(tool)).toBe(false);
    expect(tool.timeoutMs).toBeGreaterThan(30_000);
  });

  it('has JSON-schema-representable input and output, with file-derived strings marked untrusted', () => {
    expect(() => z.toJSONSchema(tool.input, { unrepresentable: 'throw', io: 'input' })).not.toThrow();
    const output = z.toJSONSchema(tool.output, { unrepresentable: 'throw' }) as unknown as {
      properties: { summary: { properties: Record<string, { untrusted?: string }> } };
    };
    const summary = output.properties.summary.properties;
    expect(summary.file?.untrusted).toBe('file-name');
    expect(summary.device?.untrusted).toBe('metadata');
    expect(summary.creationTime?.untrusted).toBe('metadata');
    expect(summary.container?.untrusted).toBeUndefined();
  });
});

describe('media.probe run', () => {
  it('runs the probe as a media.probe job, with its signal and progress', async () => {
    const ctx = testToolContext();
    const jobs = probeReturning(ok(probeResult));
    await createProbeTool({ jobs }).run({ path: '/Volumes/Trip/IMG_0420.MOV' }, ctx);
    expect(jobs.calls).toMatchObject([
      { kind: 'media.probe', input: { path: '/Volumes/Trip/IMG_0420.MOV' }, options: { signal: ctx.signal } },
    ]);
    expect(ctx.progress).toEqual([{ fraction: 0.5, note: 'reading file headers' }]);
  });

  it('returns a short summary and stores the full result as an artifact', async () => {
    const ctx = testToolContext();
    const tool = createProbeTool({ jobs: probeReturning(ok(probeResult)) });
    const result = await tool.run({ path: '/Volumes/Trip/IMG_0420.MOV' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = tool.output.parse(result.value);
    expect(output.summary).toEqual({
      file: 'IMG_0420.MOV',
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      sizeBytes: 6631245,
      duration: { value: 5001667, rate: 1000000 },
      durationSeconds: 5.002,
      video: {
        codec: 'hevc',
        profile: 'Main 10',
        width: 1080,
        height: 1920,
        rotation: 90,
        frameRate: { num: 30, den: 1 },
        fps: 30,
        variableFrameRate: true,
        hdr: ['hlg', 'dolby_vision'],
        bitDepth: 10,
      },
      audio: { codec: 'aac', channels: 2, sampleRate: 44100 },
      streamCount: 3,
      creationTime: '2026-10-01T15:30:00+0530',
      device: 'Apple iPhone 17 Pro',
    });
    expect(JSON.stringify(output.summary).length).toBeLessThan(800);

    const stored = output.details && ctx.stored.get(output.details.id);
    expect(output.details?.mediaType).toBe('application/json');
    expect(JSON.parse(new TextDecoder().decode(stored?.data))).toEqual(
      JSON.parse(JSON.stringify(probeResult)),
    );
    expect(output.details?.summary).toContain(
      'hevc 1080x1920 (rotated 90°), 30 fps VFR, HDR HLG + Dolby Vision',
    );
  });

  it('summarises for the executor when the output is spilled', () => {
    const tool = createProbeTool({ jobs: probeReturning(ok(probeResult)) });
    const text = tool.summarize?.({
      summary: { file: 'a.m4a', container: 'mov', streamCount: 1, audio: { codec: 'aac', channels: 2 } },
    });
    // No file name: it is untrusted, and summaries skip the agent's untrusted-data wrapping.
    expect(text).toBe('aac 2 ch');
  });

  it('still answers when the artifact store fails', async () => {
    const failing = testToolContext({
      artifacts: {
        put: async () => err(MediaFileNotFound({ name: 'x' })),
        get: async () => err(MediaFileNotFound({ name: 'x' })),
      },
    });
    const result = await createProbeTool({ jobs: probeReturning(ok(probeResult)) }).run(
      { path: '/a.mov' },
      failing,
    );
    expect(result.ok && result.value.details).toBeUndefined();
    expect(result.ok && result.value.summary.file).toBe('IMG_0420.MOV');
  });

  it('passes probe errors through unchanged', async () => {
    const missing = err(MediaFileNotFound({ name: 'gone.mov' }));
    const result = await createProbeTool({ jobs: probeReturning(missing) }).run(
      { path: '/gone.mov' },
      testToolContext(),
    );
    expect(result).toEqual(missing);
  });
});

describe('idempotency key and the job-ready task', () => {
  it('changes when the file is replaced or edited, not otherwise', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-probe-tool-'));
    try {
      const path = join(dir, 'clip.mov');
      await writeFile(path, 'one');
      const tool = createProbeTool({ jobs: probeReturning(ok(probeResult)) });
      const first = tool.idempotencyKey?.({ path });
      expect(first).toBe(fileFingerprint(path));
      expect(first).toMatch(/clip\.mov\|3\|\d+$/);
      expect(tool.idempotencyKey?.({ path })).toBe(first);
      await writeFile(path, 'longer');
      expect(tool.idempotencyKey?.({ path })).not.toBe(first);
      const before = tool.idempotencyKey?.({ path });
      await utimes(path, new Date(2020, 1, 1), new Date(2020, 1, 1));
      expect(tool.idempotencyKey?.({ path })).not.toBe(before);
      expect(fileFingerprint(join(dir, 'nope.mov'))).toMatch(/nope\.mov\|missing$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runs in process through the direct runner: same handler, cancellable, with progress', async () => {
    const calls: { path: string; signal?: AbortSignal }[] = [];
    const media: Pick<MediaJobDeps, 'probe'> = {
      probe: async (path, options) => {
        calls.push({ path, ...(options?.signal ? { signal: options.signal } : {}) });
        return ok(probeResult);
      },
    };
    const jobs = createDirectJobRunner(createMediaJobs(media as MediaJobDeps));
    const tool = createProbeTool({ jobs });
    const ctx = testToolContext();
    const result = await tool.run({ path: '/Volumes/Trip/IMG_0420.MOV' }, ctx);
    expect(result.ok && result.value.summary.file).toBe('IMG_0420.MOV');
    expect(calls).toEqual([{ path: '/Volumes/Trip/IMG_0420.MOV', signal: ctx.signal }]);
    expect(ctx.progress).toEqual([{ fraction: 0, note: 'reading file headers' }, { fraction: 1 }]);
  });
});
