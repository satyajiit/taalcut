// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The breakdown's job kinds and handlers: kind metadata, idempotency keys,
 * and the handlers through a direct runner on a synthetic reel (no
 * embedding model, no OCR: what a Mac without those components gets).
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirectJobRunner, type ComputeFallbackEvent } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  breakdownJobKinds,
  breakdownKey,
  readOverlaysJobInputSchema,
  SHEET_MAX_BYTES,
  visionContactSheetJob,
  visionDetectCutsJob,
  visionReadOverlaysJob,
} from '../src/jobs/breakdown-kinds';
import { breakdownJobRegistrations } from '../src/jobs/breakdown-handlers';
import type { VisionJobDeps } from '../src/jobs/deps';
import { goldenLabel, makeGoldenReel } from './breakdown/golden-reel';
import { testMedia } from './helpers/reel';

const { ctx, skip } = await testMedia('jobs-breakdown');

describe('kinds', () => {
  it('run high priority on their hardware class, with plain JSON inputs and outputs', () => {
    expect(breakdownJobKinds.map((k) => [k.kind, k.resource, k.priority, k.timeoutMs])).toEqual([
      ['vision.detectCuts', 'video', 'high', 600_000],
      ['vision.readOverlays', 'npu', 'high', 600_000],
      ['vision.contactSheet', 'video', 'high', 120_000],
    ]);
    for (const kind of breakdownJobKinds) {
      expect(() => z.toJSONSchema(kind.input, { unrepresentable: 'throw', io: 'input' })).not.toThrow();
      expect(() => z.toJSONSchema(kind.output, { unrepresentable: 'throw' })).not.toThrow();
    }
    expect(readOverlaysJobInputSchema.parse({ path: '/a.mp4', languages: ['en'] }).fps).toBe(4);
  });

  it('keys on the content hash when there is one, else the file, and on the options', () => {
    const a = breakdownKey('vision.detectCuts', { path: '/a.mp4', contentHash: 'h1' }, { s: 1 });
    expect(a).toMatch(/^vision\.detectCuts:v1:[0-9a-f]{64}:[0-9a-f]{16}$/);
    expect(breakdownKey('vision.detectCuts', { path: '/b.mp4', contentHash: 'h1' }, { s: 1 })).toBe(a);
    expect(breakdownKey('vision.detectCuts', { path: '/a.mp4', contentHash: 'h1' }, { s: 2 })).not.toBe(a);
    expect(breakdownKey('vision.detectCuts', { path: '/a.mp4' }, { s: 1 })).not.toBe(a);
    const key = (sensitivity: 'normal' | 'high') =>
      visionDetectCutsJob.idempotencyKey?.(
        visionDetectCutsJob.input.parse({ path: '/a.mp4', sensitivity }) as never,
      );
    expect(key('normal')).not.toBe(key('high'));
    const sheet = (frames: number[]) =>
      visionContactSheetJob.idempotencyKey?.({ path: '/a.mp4', layout: { kind: 'frames', frames } });
    expect(sheet([1, 2])).not.toBe(sheet([1, 3]));
  });
});

describe.skipIf(!ctx)(`handlers on a synthetic reel ${skip}`, () => {
  const label = goldenLabel('sample-es-25');
  let dir = '';
  let path = '';
  const fallbacks: ComputeFallbackEvent[] = [];
  const runner = () =>
    createDirectJobRunner(
      breakdownJobRegistrations({
        media: ctx!,
        tier: 'recommended',
        tempDir: dir,
        onFallback: (event) => fallbacks.push(event),
      } satisfies VisionJobDeps),
    );

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-breakdown-jobs-'));
    path = join(dir, 'es-25.mp4');
    await makeGoldenReel(ctx!, path, label);
  }, 120_000);
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('detectCuts finds the hard cut on scdet alone and says what did not run', async () => {
    const jobs = runner();
    const result = await jobs.run(visionDetectCutsJob, { path, sensitivity: 'normal' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ frameRate: { num: 25, den: 1 }, frameCount: 250, softScanFps: 0 });
    expect(result.value.notes.join(' ')).toMatch(/No embedding model/);
    // scdet alone scores this cut around 24, under `confirmScore`: kept as a dispute for the model, not dropped.
    const cut = result.value.cuts.find((c) => Math.abs(c.frame - 150) <= 2);
    expect(cut).toMatchObject({ kind: 'hard', method: 'scdet' });
    expect(['confirmed', 'disputed']).toContain(cut?.status);
    // The dissolve at 50 needs the embedding scan.
    expect(result.value.cuts.filter((c) => c.kind === 'soft')).toEqual([]);
    // A second run in the same process logs no second fallback record.
    await jobs.run(visionDetectCutsJob, {
      path,
      sensitivity: 'normal',
      range: {
        start: { value: 100, rate: { num: 25, den: 1 } },
        duration: { value: 100, rate: { num: 25, den: 1 } },
      },
    });
    expect(fallbacks.map((f) => f.operation)).toEqual(['vision.sceneScores']);
  }, 120_000);

  it('readOverlays without an OCR engine says OCR is unavailable', async () => {
    const result = await runner().run(visionReadOverlaysJob, { path, fps: 4, languages: ['hi'] });
    expect(!result.ok && result.error.code).toBe('vision.ocr_unavailable');
  });

  it('contactSheet makes every layout as a JPEG under its cap', async () => {
    const jobs = runner();
    const shots = await jobs.run(visionContactSheetJob, {
      path,
      layout: { kind: 'shots', cuts: [...label.cuts] },
    });
    expect(shots.ok).toBe(true);
    if (!shots.ok) return;
    expect(shots.value.layout.map((t) => t.frame)).toEqual([24, 99, 199]);
    // 360×640 at a 180 px long side; widths round to even for the chroma planes.
    expect(shots.value).toMatchObject({
      columns: 3,
      tileWidth: 102,
      tileHeight: 180,
      width: 306,
      height: 180,
    });
    const jpeg = Buffer.from(shots.value.jpegBase64, 'base64');
    expect(jpeg.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(jpeg.length).toBeLessThanOrEqual(600 * 1024);

    const rate = { num: 25, den: 1 };
    const strips = await jobs.run(visionContactSheetJob, {
      path,
      layout: {
        kind: 'strips',
        candidates: [
          { value: 150, rate },
          { value: 6, rate: { num: 30, den: 1 } },
        ],
      },
    });
    expect(strips.ok && strips.value.layout.map((t) => [t.frame, t.row])).toEqual([
      [148, 0],
      [149, 0],
      [150, 0],
      [151, 0],
      [152, 0],
      [3, 1],
      [4, 1],
      [5, 1],
      [6, 1],
      [7, 1],
    ]);
    expect(strips.ok && [strips.value.columns, strips.value.width]).toEqual([5, 5 * 144]);

    const tiny = await jobs.run(visionContactSheetJob, {
      path,
      layout: { kind: 'frames', frames: Array.from({ length: 60 }, (_, i) => i * 4) },
      tileLongSide: 512,
      maxBytes: 32 * 1024,
    });
    expect(!tiny.ok && tiny.error.code).toBe('media.output_too_large');
    expect(SHEET_MAX_BYTES).toBe(2 * 1024 * 1024);
    // The raw frame file is gone after each sheet.
    expect(await readdir(dir)).toEqual(['es-25.mp4']);
  }, 120_000);
});
