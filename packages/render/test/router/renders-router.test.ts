// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The renders router over a real IPC port: presets, export options, the
 * list and its live updates, QA reports, video URLs, preview calls and
 * subtitles. Nothing a window gets holds a path.
 */
import { readFile } from 'node:fs/promises';
import { MessageChannel } from 'node:worker_threads';
import { join } from 'node:path';
import {
  callRpc,
  connectRpc,
  FrameRate,
  newId,
  ok,
  rendersContract,
  serveRpc,
  type PreviewSession,
  type QaReport,
  type RenderSnapshot,
  type Timeline,
} from '@taalcut/core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createLiveRenders, type LiveRenders } from '../../src/engine/live';
import type { PreviewSessions } from '../../src/engine/previews';
import { ESTIMATE } from '../../src/router/export-options';
import { rendersRouter, subtitleFileName } from '../../src/router/renders-router';
import { tempDir } from '../support/media';
import { captionTrackOf, makeTimeline } from '../support/timeline';
import { fakeWorld, renderRecord, type FakeWorld } from './fixtures';

const rate = FrameRate.of(30);
const ports: MessageChannel[] = [];
afterEach(() => {
  for (const channel of ports.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

const session: PreviewSession = {
  timelineRevision: 1,
  sessionId: newId<'PreviewSession'>(),
  url: `app://preview/${'0'.repeat(32)}/index.html?rev=0`,
  revision: 0,
  width: 1080,
  height: 1920,
  rate,
  durationFrames: 60,
  compositionHash: 'a'.repeat(64),
};

describe('renders router', () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  let world: FakeWorld;
  let live: LiveRenders;
  let timeline: Timeline;
  const opened: string[] = [];

  const previews: PreviewSessions = {
    open: async (projectId) => (opened.push(projectId), ok(session)),
    refresh: async () => ok({ ...session, revision: 1 }),
    close: async () => ok({ closed: true }),
    mediaFolder: async (key) => {
      const token = key.endsWith(':video') ? '1'.repeat(32) : '2'.repeat(32);
      const dir = join(world.deps.folders.preview, token);
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
      return { token, dir, url: (file: string) => `app://preview/${token}/${file}` };
    },
    sweep: async () => 0,
    closeAll: async () => undefined,
  };

  function client() {
    const channel = new MessageChannel();
    ports.push(channel);
    serveRpc(rendersRouter(world.deps, live, previews, { pollMs: 20 }), channel.port1, { context: {} });
    return connectRpc(rendersContract, channel.port2, { peer: 'render' }).client;
  }

  beforeAll(async () => {
    work = await tempDir('renders-router');
    world = await fakeWorld(work.dir);
    live = createLiveRenders(() => world.clock.now());
    timeline = makeTimeline({
      rate,
      items: [{ frames: 60 }],
      captions: captionTrackOf(rate, [
        [0, 30, 'hello <b>there</b>'],
        [30, 30, 'again'],
      ]),
    });
    world.timelines.set(timeline.id, { ...timeline, name: 'My: video/cut?' });
  });
  afterAll(async () => work?.dispose());

  it('lists every preset', async () => {
    const presets = await client().presets();
    expect(presets.map((preset) => preset.id)).toEqual([
      'shorts',
      'reels',
      'tiktok',
      'device',
      'deviceHevc',
      'landscape',
      'standard',
      'youtubeAv1',
      'deviceAv1',
      'square',
      'portrait',
      'square2160',
      'portrait2160',
      'master4k',
      'landscape4k',
    ]);
  });

  it('offers export options with availability, estimates and the music and caption state', async () => {
    const options = await callRpc(
      client().exportOptions({ projectId: timeline.projectId, timelineId: timeline.id }),
    );
    if (!options.ok) throw new Error(options.error.code);
    const reels = options.value.presets.find((entry) => entry.preset.id === 'reels')!;
    expect(reels).toMatchObject({ available: false, reasonKey: 'render.unavailable.tooShort' });
    const device = options.value.presets.find((entry) => entry.preset.id === 'device')!;
    expect(device.available).toBe(true);
    expect(device.estimate.bytes).toBe(Math.round(((8_192 * 1000) / 8) * 2 * ESTIMATE.containerOverhead));
    expect(options.value).toMatchObject({
      timelineRevision: timeline.revision,
      durationFrames: 60,
      defaultPresetId: 'device',
      music: {
        current: { path: 'platformSound' },
        // Nothing to acknowledge since REF1; no template, so no reel to play.
        referenceAudioAcknowledged: true,
        referenceAudioAvailable: false,
      },
      captions: { available: true, enabled: true, language: 'en' },
    });
    expect(options.value.music.platformSound?.steps.map((step) => step.platform)).toEqual([
      'shorts',
      'reels',
      'tiktok',
    ]);
    expect(options.value.music.platformSound).toMatchObject({ referenceUrl: null, soundLabel: null });
    const other = await callRpc(
      client().exportOptions({ projectId: newId<'Project'>(), timelineId: timeline.id }),
    );
    expect(!other.ok && other.error.code).toBe('core.not_found');
  });

  it('lists renders newest first without deleted ones or anything a window must not see', async () => {
    const older = renderRecord(timeline, { createdAt: 10, filePath: '/secret/older.mp4' });
    const newer = renderRecord(timeline, { createdAt: 20, status: 'rendering' });
    const gone = renderRecord(timeline, { createdAt: 30, deletedAt: 40 });
    const elsewhere = renderRecord(makeTimeline({ items: [{ frames: 30 }] }), { createdAt: 50 });
    for (const record of [older, newer, gone, elsewhere]) await world.store.create(record);
    live.setProgress(newer.id, { fraction: 0.5, stageKey: 'render.stage.capturing' }, true);
    const listed = await client().list({ projectId: timeline.projectId });
    expect(listed.map((render) => render.id)).toEqual([newer.id, older.id]);
    expect(listed[0]!.progress).toMatchObject({ fraction: 0.5 });
    const keys = Object.keys(listed[1]!);
    for (const hidden of ['filePath', 'request', 'requestKey', 'qaReport', 'compositionHash'])
      expect(keys).not.toContain(hidden);
    expect(JSON.stringify(listed)).not.toContain('/secret/');
    expect((await client().get({ renderId: newer.id })).progress).toMatchObject({ fraction: 0.5 });
    live.setProgress(newer.id, null);
  });

  it('watches the list: now, on live progress, on another process’s write, never twice the same', async () => {
    const project = makeTimeline({ items: [{ frames: 30 }] });
    const first = renderRecord(project, { status: 'rendering', createdAt: 100 });
    await world.store.create(first);
    const controller = new AbortController();
    const stream = await client().watch({ projectId: project.projectId }, { signal: controller.signal });
    const seen: RenderSnapshot[][] = [];
    const reading = (async () => {
      for await (const list of stream) {
        seen.push(list);
        if (seen.length === 1) live.setProgress(first.id, { fraction: 0.25 }, true);
        if (seen.length === 2) await world.store.create(renderRecord(project, { createdAt: 200 }));
        if (seen.length === 3) controller.abort();
      }
    })();
    await reading.catch(() => undefined);
    expect(seen.map((list) => list.length)).toEqual([1, 1, 2]);
    expect(seen[1]![0]!.progress).toMatchObject({ fraction: 0.25 });
    live.setProgress(first.id, null);
  });

  it('returns a stored QA report, and not_found without one', async () => {
    const report: QaReport = {
      version: 1,
      renderId: newId<'Render'>(),
      round: 1,
      verdict: 'passed',
      presetId: 'device',
      checks: [],
      overrides: [],
      createdAt: 5,
    };
    const record = renderRecord(timeline, { id: report.renderId, qaReport: report });
    const bare = renderRecord(timeline);
    await world.store.create(record);
    await world.store.create(bare);
    expect(await client().qaReport({ renderId: record.id })).toEqual(report);
    const missing = await callRpc(client().qaReport({ renderId: bare.id }));
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
  });

  it('gives a video URL only for a finished render, through a manifest', async () => {
    const queued = renderRecord(timeline, { status: 'queued' });
    const ready = renderRecord(timeline, { filePath: join(world.deps.folders.renders, 'r.mp4') });
    await world.store.create(queued);
    await world.store.create(ready);
    const refused = await callRpc(client().mediaUrl({ renderId: queued.id, kind: 'video' }));
    expect(!refused.ok && refused.error.code).toBe('render.not_ready');
    const { url } = await client().mediaUrl({ renderId: ready.id, kind: 'video' });
    expect(url).toBe(`app://preview/${'1'.repeat(32)}/video.mp4`);
    const manifest = JSON.parse(
      await readFile(join(world.deps.folders.preview, '1'.repeat(32), 'manifest.json'), 'utf8'),
    );
    expect(manifest).toEqual({ 'video.mp4': ready.filePath });
    const frame = await callRpc(client().mediaUrl({ renderId: ready.id, kind: 'frame' }));
    expect(!frame.ok && frame.error.code).toBe('core.validation');
  });

  it('passes preview calls to the sessions', async () => {
    const rpc = client();
    expect(await rpc.openPreview({ projectId: timeline.projectId, timelineId: timeline.id })).toEqual(
      session,
    );
    expect(opened).toContain(timeline.projectId);
    expect((await rpc.refreshPreview({ sessionId: session.sessionId })).revision).toBe(1);
    expect(await rpc.closePreview({ sessionId: session.sessionId })).toEqual({ closed: true });
  });

  it('exports captions as SRT and VTT under a safe file name', async () => {
    const srt = await client().subtitles({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      format: 'srt',
    });
    expect(srt.fileName).toBe('My- video-cut-.srt');
    expect(srt.text).toContain('00:00:00,000 --> 00:00:01,000\r\nhello <b>there</b>');
    const vtt = await client().subtitles({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      format: 'vtt',
    });
    expect(vtt.text.startsWith('WEBVTT')).toBe(true);
    expect(vtt.text).toContain('hello &lt;b&gt;there&lt;/b&gt;');
    const bare = makeTimeline({ items: [{ frames: 30 }] });
    world.timelines.set(bare.id, bare);
    const none = await callRpc(
      client().subtitles({ projectId: bare.projectId, timelineId: bare.id, format: 'srt' }),
    );
    expect(!none.ok && none.error.code).toBe('core.not_found');
  });

  it('cleans file names', () => {
    expect(subtitleFileName('  ../a\u0000b  ', 'vtt')).toBe('-ab.vtt');
    expect(subtitleFileName('...', 'srt')).toBe('captions.srt');
  });
});
