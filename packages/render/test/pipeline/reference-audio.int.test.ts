// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * REF1-SOUND's "done when": a template that keeps its reel exports with the reel's music in the file, on the beat
 * map. The reel is synthetic and built like a fetched one (H.264 and AAC in one mp4): a low tone under short
 * 3 kHz bursts that start exactly on known beats. The timeline's beat map says those times and its clips are muted,
 * so the only sound is the reel's. The whole export runs (capture, mix, two-pass loudness, AAC, mux, QA), and every
 * burst is found in the delivered file's audio within one frame of its beat. Without the reel, the export stops at
 * preflight with render.media_missing and "Get the reel's video and music" as the fix, rendering nothing.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, newId, ok, type TemplateId, type Timeline } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { runExport } from '../../src/engine/export-run';
import { createLiveRenders } from '../../src/engine/live';
import { keptReferenceAudio } from '../../src/music/reference-audio';
import { decodePcm } from '../audio/helpers';
import { reelMedia } from '../router/fixtures';
import { movingClip, testEngine } from '../support/engine';
import { exportToEnd, failing, queueRender } from '../support/export-record';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { FIXTURE_H264 } from '../support/host-video';
import { findTestShell } from '../support/shell';
import { beatMapOf, makeTimeline } from '../support/timeline';

const media = await findTestMedia('reference audio export');
const shell = findTestShell('reference audio export');
const rate = FrameRate.of(30);
/** One frame at 30 fps, in 48 kHz samples: the tolerance the work package names. */
const FRAME_SAMPLES = 48_000 / 30;
/** Off the frame grid on purpose, so the music can't line up just because the cuts do. */
const BEATS_MS = [437, 958, 1501, 2042, 2563, 3105];
const BURST_SAMPLES = 480;

/** The reel's sound as an aevalsrc expression of the sample number n: a 200 Hz bed and a burst on every beat. */
function reelSound(): string {
  const bursts = BEATS_MS.map((ms) => {
    const at = ms * 48;
    return `if(between(n,${at},${at + BURST_SAMPLES - 1}),0.15*sin(2*PI*3000*(n-${at})/48000),0)`;
  });
  return ['0.15*sin(2*PI*200*n/48000)', ...bursts].join('+');
}

/**
 * Where each burst starts in `pcm`: the first sample near its beat whose step from the one before is large. The
 * bed's steps are about 0.004 per unit of gain and a burst's about 0.06, so a threshold of 40% of the largest step
 * finds bursts only, however loudness normalisation scaled both.
 */
function burstOnsets(pcm: Float32Array): number[] {
  let largest = 0;
  for (let i = 1; i < pcm.length; i++) largest = Math.max(largest, Math.abs(pcm[i]! - pcm[i - 1]!));
  const threshold = largest * 0.4;
  return BEATS_MS.map((ms) => {
    const expected = ms * 48;
    const from = Math.max(1, expected - 3 * FRAME_SAMPLES);
    const to = Math.min(pcm.length, expected + 3 * FRAME_SAMPLES);
    for (let i = from; i < to; i++) if (Math.abs(pcm[i]! - pcm[i - 1]!) > threshold) return i;
    return -1;
  });
}

describe.skipIf(!media.binaries || !shell.path)('the reel’s music in an export', { timeout: 600_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let reel: string;
  const footage = newId<'Asset'>();
  const templateId = newId<'Template'>();

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('reference-audio');
    await movingClip(ctx, join(work.dir, 'footage.mp4'), { frames: 150, rate: '30', silent: true });
    // The kept reel, as the fetcher leaves it: picture and sound in one mp4 (AAC, with its priming in the edit list).
    reel = join(work.dir, 'reference.mp4');
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x568:r=30',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc='${reelSound()}':s=48000:c=stereo`,
      '-t',
      '4',
      '-c:v',
      FIXTURE_H264,
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      reel,
    ]);
  });
  afterAll(async () => work?.dispose());

  /** A cut of the user's muted footage, made from the template, its beat map the reel's, its music the reel's. */
  const cutFromTemplate = (): Timeline => ({
    ...makeTimeline({
      rate,
      items: [
        { frames: 54, assetId: footage, sourceStart: 0, mediaFrames: 150, mediaRate: rate, muted: true },
        { frames: 54, assetId: footage, sourceStart: 60, mediaFrames: 150, mediaRate: rate, muted: true },
      ],
      beatMap: beatMapOf(BEATS_MS),
      music: { path: 'referenceAudio', templateId, gainDb: 0 },
    }),
    template: { id: templateId, version: 1 },
  });

  const engineWith = (root: string, kept: (id: TemplateId) => string | null) => {
    const engine = testEngine(join(work.dir, root), ctx, shell.path!, {
      referenceAudio: keptReferenceAudio({
        kept: async (id) => {
          const path = kept(id);
          return ok(path ? { media: reelMedia(), path } : null);
        },
      }),
    });
    engine.assets.set(footage, join(work.dir, 'footage.mp4'));
    return engine;
  };

  it('mixes the kept reel’s music into the file, every beat within one frame', async () => {
    const engine = engineWith('kept', (id) => (id === templateId ? reel : null));
    const stored = await exportToEnd(engine, await queueRender(engine, cutFromTemplate()));
    expect(failing(stored)).toEqual([]);
    expect(stored.status).toBe('ready');
    const pcm = await decodePcm(ctx, stored.filePath!);
    expect(pcm.length).toBe(108 * FRAME_SAMPLES);
    const onsets = burstOnsets(pcm);
    const errors = onsets.map((found, index) => found - BEATS_MS[index]! * 48);
    console.warn(`[reference audio] burst onset error per beat (samples at 48 kHz): ${errors.join(', ')}`);
    expect(onsets.every((found) => found >= 0)).toBe(true);
    for (const error of errors) expect(Math.abs(error)).toBeLessThanOrEqual(FRAME_SAMPLES);
  });

  it('stops at preflight with the fix to fetch the reel again when it is gone, rendering nothing', async () => {
    const engine = engineWith('gone', () => null);
    const record = await queueRender(engine, cutFromTemplate());
    const result = await runExport(engine.deps, createLiveRenders(), {
      renderId: record.id,
      request: record.request,
    });
    expect(result.ok ? null : result.error).toMatchObject({
      code: 'render.media_missing',
      params: { name: 'reference audio' },
      fix: { command: 'templates.fetchMedia', payload: { id: templateId } },
    });
    const rendered = await readdir(engine.deps.folders.renders).catch(() => []);
    expect(rendered).toEqual([]);
  });
});
