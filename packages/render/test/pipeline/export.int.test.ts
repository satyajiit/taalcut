// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The whole export on real media (P2-M6, gate criterion 4): a render that
 * passes QA lands in the renders folder as an H.264 High MP4 tagged BT.709
 * with -14 LUFS AAC, its report stored and render.finished emitted; one
 * that fails QA, or fails preflight, never reaches the renders folder; a
 * cancelled one leaves nothing behind; a finished one is never rendered
 * twice.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, newId, type Timeline } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { runExport, workFolder } from '../../src/engine/export-run';
import { createLiveRenders } from '../../src/engine/live';
import { measureLoudness } from '../../src/audio/loudness';
import { movingClip, testEngine, type TestEngine } from '../support/engine';
import { queueRender } from '../support/export-record';
import { findTestMedia, mediaContext, probeJson, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { captionTrackOf, makeTimeline } from '../support/timeline';

const media = await findTestMedia('export');
const shell = findTestShell('export');
const skip = !media.binaries || !shell.path;
const rate = FrameRate.of(30);

/** A render row as render.export stores it: captions burnt in with an SRT sidecar. */
const addRender = (engine: TestEngine, timeline: Timeline, notify = true) =>
  queueRender(engine, timeline, { sidecars: ['srt'], notify });

describe.skipIf(skip)('export', { timeout: 600_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  const moving = newId<'Asset'>();
  const mute = newId<'Asset'>();

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('export');
    await movingClip(ctx, join(work.dir, 'moving.mp4'), { frames: 150, rate: '30' });
    await movingClip(ctx, join(work.dir, 'mute.mp4'), {
      frames: 150,
      rate: '30',
      size: '540x960',
      silent: true,
    });
  });
  afterAll(async () => work?.dispose());

  it('delivers a render that passes QA, with its report, sidecar and finished event', async () => {
    const engine = testEngine(join(work.dir, 'pass'), ctx, shell.path!);
    engine.assets.set(moving, join(work.dir, 'moving.mp4'));
    const timeline = makeTimeline({
      rate,
      items: [
        { frames: 45, assetId: moving, sourceStart: 0, mediaFrames: 150, mediaRate: rate },
        { frames: 45, assetId: moving, sourceStart: 60, mediaFrames: 150, mediaRate: rate },
      ],
      captions: captionTrackOf(rate, [
        [0, 40, 'Hello from Taalcut'],
        [45, 40, 'Second cue here'],
      ]),
    });
    const record = await addRender(engine, timeline);
    const progress: number[] = [];
    const result = await runExport(
      engine.deps,
      createLiveRenders(),
      { renderId: record.id, request: record.request },
      {
        onProgress: (p) => progress.push(p.fraction ?? 0),
      },
    );
    if (!result.ok) throw new Error(`${result.error.code} ${result.error.detail ?? ''}`);
    const stored = engine.store.records.get(record.id)!;
    expect(
      stored.qaReport?.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ).toEqual([]);
    expect(result.value.status).toBe('ready');
    expect(stored.filePath).toBe(join(engine.deps.folders.renders, timeline.projectId, `${record.id}.mp4`));
    expect(existsSync(join(engine.deps.folders.renders, timeline.projectId, `${record.id}.srt`))).toBe(true);
    expect(existsSync(workFolder(engine.deps, record.id))).toBe(false);
    expect(progress.at(-1)).toBeGreaterThan(0.8);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true);

    const probe = (await probeJson(
      ctx,
      stored.filePath!,
      'stream=codec_name,profile,color_primaries,color_transfer,color_space,nb_read_packets,sample_rate',
    )) as {
      streams: Record<string, string>[];
    };
    const [video, audio] = probe.streams;
    expect(video).toMatchObject({
      codec_name: 'h264',
      profile: 'High',
      color_primaries: 'bt709',
      color_transfer: 'bt709',
      color_space: 'bt709',
      nb_read_packets: '90',
    });
    expect(audio).toMatchObject({ codec_name: 'aac', sample_rate: '48000' });
    const loudness = await measureLoudness(ctx, stored.filePath!);
    if (!loudness.ok) throw new Error(loudness.error.code);
    expect(Math.abs(loudness.value!.integratedLufs + 14)).toBeLessThanOrEqual(1);
    const finished = engine.events.filter((event) => event.type === 'render.finished');
    expect(finished.map((event) => event.payload)).toEqual([
      {
        renderId: record.id,
        projectId: timeline.projectId,
        status: 'ready',
        notify: true,
        name: record.name,
      },
    ]);

    // Finished renders are never rendered again: a re-run answers with the stored state.
    const again = await runExport(engine.deps, createLiveRenders(), {
      renderId: record.id,
      request: record.request,
    });
    expect(again.ok && again.value.status).toBe('ready');
    expect(engine.events.filter((event) => event.type === 'render.finished')).toHaveLength(1);
  });

  it('keeps a render that fails QA out of the renders folder (gate criterion 4)', async () => {
    const engine = testEngine(join(work.dir, 'fail'), ctx, shell.path!);
    engine.assets.set(mute, join(work.dir, 'mute.mp4'));
    // A clip whose sound is digital silence: the render loses the sound the plan expects (silence fails), and
    // the automatic renormalise can't bring it back, so the render waits for the user.
    const timeline = makeTimeline({
      rate,
      items: [{ frames: 120, assetId: mute, sourceStart: 0, mediaFrames: 150, mediaRate: rate }],
    });
    const record = await addRender(engine, timeline, false);
    const result = await runExport(engine.deps, createLiveRenders(), {
      renderId: record.id,
      request: record.request,
    });
    if (!result.ok) throw new Error(`${result.error.code} ${result.error.detail ?? ''}`);
    expect(result.value.status).toBe('needsAttention');
    const stored = engine.store.records.get(record.id)!;
    expect(stored.filePath).toBeNull();
    expect(stored.qaReport?.verdict).toBe('needsAttention');
    expect(stored.qaReport?.checks.find((check) => check.id === 'silence')?.status).toBe('fail');
    expect(existsSync(join(engine.deps.folders.renders, timeline.projectId))).toBe(false);
    expect(await readdir(workFolder(engine.deps, record.id))).toContain('final.mp4');
  });

  it('stops at preflight when an original is missing, rendering nothing', async () => {
    const engine = testEngine(join(work.dir, 'missing'), ctx, shell.path!);
    const timeline = makeTimeline({
      rate,
      items: [{ frames: 60, assetId: newId<'Asset'>(), sourceStart: 0 }],
    });
    const record = await addRender(engine, timeline);
    const result = await runExport(engine.deps, createLiveRenders(), {
      renderId: record.id,
      request: record.request,
    });
    expect(result.ok && result.value.status).toBe('needsAttention');
    const report = engine.store.records.get(record.id)!.qaReport!;
    expect(report.checks.find((check) => check.id === 'preflightMedia')?.status).toBe('fail');
    expect(existsSync(join(engine.deps.folders.work, record.id, 'final.mp4'))).toBe(false);
  });

  it('cancels when the store says so, leaving no files', async () => {
    const engine = testEngine(join(work.dir, 'cancel'), ctx, shell.path!);
    engine.assets.set(moving, join(work.dir, 'moving.mp4'));
    const timeline = makeTimeline({
      rate,
      items: [{ frames: 150, assetId: moving, sourceStart: 0, mediaFrames: 150, mediaRate: rate }],
    });
    const record = await addRender(engine, timeline);
    let cancelled = false;
    const result = await runExport(
      engine.deps,
      createLiveRenders(),
      { renderId: record.id, request: record.request },
      {
        onProgress: (progress) => {
          if (!cancelled && progress.stageKey === 'render.stage.capturing') {
            cancelled = true;
            void engine.store.update(record.id, { status: 'cancelled', finishedAt: Date.now() });
          }
        },
      },
    );
    expect(result.ok ? 'ok' : result.error.code).toBe('core.cancelled');
    expect(engine.store.records.get(record.id)!.status).toBe('cancelled');
    expect(existsSync(workFolder(engine.deps, record.id))).toBe(false);
    expect(existsSync(join(engine.deps.folders.renders, timeline.projectId))).toBe(false);
    expect(
      engine.events
        .filter((event) => event.type === 'render.finished')
        .map((event) => (event.payload as { status: string }).status),
    ).toEqual(['cancelled']);
  });

  it('puts a caller-aborted render back to queued and lets a reclaimed caller join an in-flight export', async () => {
    const engine = testEngine(join(work.dir, 'reclaim'), ctx, shell.path!);
    engine.assets.set(moving, join(work.dir, 'moving.mp4'));
    const timeline = makeTimeline({
      rate,
      items: [{ frames: 120, assetId: moving, sourceStart: 0, mediaFrames: 150, mediaRate: rate }],
    });
    const record = await addRender(engine, timeline);
    const live = createLiveRenders();

    // 1. Caller aborts alone (store is still rendering, not cancelled): row goes back to queued, not cancelled.
    const first = new AbortController();
    const aborted = await runExport(
      engine.deps,
      live,
      { renderId: record.id, request: record.request },
      {
        signal: first.signal,
        onProgress: (progress) => {
          if (progress.stageKey === 'render.stage.capturing') first.abort();
        },
      },
    );
    expect(aborted.ok ? 'ok' : aborted.error.code).toBe('core.cancelled');
    expect(engine.store.records.get(record.id)!.status).toBe('queued');
    expect(engine.events.filter((event) => event.type === 'render.finished')).toEqual([]);

    // 2. Reclaimed run starts, and a second caller joins the same in-flight export while the first disconnects.
    const second = new AbortController();
    let joined: ReturnType<typeof runExport> | undefined;
    const running = runExport(
      engine.deps,
      live,
      { renderId: record.id, request: record.request },
      {
        signal: second.signal,
        onProgress: (progress) => {
          if (!joined && progress.stageKey === 'render.stage.capturing') {
            joined = runExport(engine.deps, live, { renderId: record.id, request: record.request });
            second.abort();
          }
        },
      },
    );
    const firstResult = await running;
    expect(firstResult.ok ? 'ok' : firstResult.error.code).toBe('core.cancelled');
    expect(joined).toBeDefined();
    const secondResult = await joined!;
    expect(secondResult.ok && secondResult.value.status).toBe('ready');
    expect(engine.store.records.get(record.id)!.status).toBe('ready');
  });
});
