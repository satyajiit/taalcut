// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Each clip's segment pass (qa/passes/segment-passes.ts) over a held-frame fixture made with the bundled FFmpeg: a
 * retryable failure runs once more, so a process the machine refused under load doesn't make the footage's own
 * darkness or stillness look like the render's; a failure that won't change isn't repeated; a segment is decoded
 * once per run. The stillness a freeze asks about runs the same retry (passWithRetry).
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { err } from '@taalcut/core';
import { runProcess, SpawnFailed, type MediaContext, type ProcessRunner } from '@taalcut/media';
import { segmentPasses } from '../../src/qa/passes/segment-passes';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { PASS_VIDEO, rate30 } from './support';

const media = await findTestMedia('qa segment passes');

describe.skipIf(!media.binaries)('segment passes', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let held: string;

  /** The real runner, refusing the first `refusals` ffmpeg runs the way a spawn under load is refused. */
  function refusing(refusals: number): { readonly ctx: MediaContext; readonly runs: () => number } {
    let runs = 0;
    const runner: ProcessRunner = async (command, args, options) => {
      runs += 1;
      if (runs <= refusals) return err(SpawnFailed({}, { detail: 'spawn EAGAIN' }));
      return runProcess(command, args, options);
    };
    return { ctx: { ...ctx, runner }, runs: () => runs };
  }

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('qa-segments');
    held = join(work.dir, 'held.mp4');
    // A second of one held frame: the footage itself is still.
    await ffmpeg(ctx, ['-filter_complex', 'color=c=0x204080:s=540x960:r=30:d=1', ...PASS_VIDEO, '-an', held]);
  });
  afterAll(() => work?.dispose());

  it('runs a refused segment pass once more and has the footage measured', async () => {
    const run = refusing(1);
    const passes = segmentPasses(run.ctx, new Map([['clip-a', { path: held, startFrame: 12 }]]), {
      rate: rate30,
    });
    const segment = await passes('clip-a');
    expect(segment?.startFrame).toBe(12);
    expect(segment?.pass.freezes.length).toBeGreaterThan(0);
    expect(run.runs()).toBe(2);
    // Asked again by the next check, the segment isn't decoded again.
    expect(await passes('clip-a')).toBe(segment);
    expect(run.runs()).toBe(2);
  });

  it('gives up after the second refusal', async () => {
    const run = refusing(2);
    const passes = segmentPasses(run.ctx, new Map([['clip-a', { path: held, startFrame: 0 }]]), {
      rate: rate30,
    });
    expect(await passes('clip-a')).toBeUndefined();
    expect(run.runs()).toBe(2);
  });

  it("doesn't repeat a failure that won't change, and has nothing for a clip without a segment", async () => {
    const run = refusing(0);
    const missing = join(work.dir, 'missing.mp4');
    const passes = segmentPasses(run.ctx, new Map([['clip-a', { path: missing, startFrame: 0 }]]), {
      rate: rate30,
      decode: 'software',
    });
    expect(await passes('clip-a')).toBeUndefined();
    expect(run.runs()).toBe(1);
    expect(await passes('clip-b')).toBeUndefined();
    expect(run.runs()).toBe(1);
  });
});
