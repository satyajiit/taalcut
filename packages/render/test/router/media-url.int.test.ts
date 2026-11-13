// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * renders.mediaUrl's pictures with the bundled FFmpeg: the poster is frame 0
 * at poster size, a frame is frame k at full size, each decoded once into
 * the render's token folder and served by name.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FrameRate, type Timeline } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPreviewSessions, type PreviewSessions } from '../../src/engine/previews';
import { renderMediaUrl } from '../../src/router/media-url';
import { ffmpeg, findTestMedia, mediaContext, patchColour, probeJson, tempDir } from '../support/media';
import { makeTimeline } from '../support/timeline';
import { fakeWorld, renderRecord, type FakeWorld } from './fixtures';
import { FIXTURE_H264 } from '../support/host-video';

const media = await findTestMedia('media-url');
const colourOf = (n: number) => [(n * 37 + 20) % 256, (n * 91 + 40) % 256, (n * 53 + 60) % 256];

describe.skipIf(!media.binaries)('render media URLs', { timeout: 120_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let world: FakeWorld;
  let previews: PreviewSessions;
  let timeline: Timeline;
  let file: string;

  const fileOf = (url: string) => {
    const [, token, name] = /^app:\/\/preview\/([0-9a-f]{32})\/(.+)$/.exec(url)!;
    return join(world.deps.folders.preview, token!, name!);
  };
  const nearestFrame = (colour: readonly number[]) => {
    const distance = (n: number) =>
      colourOf(n).reduce((sum, value, index) => sum + (value - colour[index]!) ** 2, 0);
    return Array.from({ length: 60 }, (_, n) => n).sort((a, b) => distance(a) - distance(b))[0];
  };

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('media-url');
    world = await fakeWorld(join(work.dir, 'world'), { ctx });
    previews = createPreviewSessions(world.deps);
    timeline = makeTimeline({ rate: FrameRate.of(30), items: [{ frames: 60 }] });
    file = join(world.deps.folders.renders, 'render.mp4');
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'nullsrc=s=270x480:r=30:d=2',
      '-vf',
      "geq=r='mod(N*37+20,256)':g='mod(N*91+40,256)':b='mod(N*53+60,256)',format=yuv444p",
      '-c:v',
      FIXTURE_H264,
      '-b:v',
      '20M',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
  });
  afterAll(async () => {
    await previews?.closeAll();
    await work?.dispose();
  });

  it('decodes the poster and frames once, at their sizes', async () => {
    const record = renderRecord(timeline, { filePath: file, durationFrames: 60, status: 'needsAttention' });
    await world.store.create(record);
    const poster = await renderMediaUrl(world.deps, previews, { renderId: record.id, kind: 'poster' });
    if (!poster.ok) throw new Error(`${poster.error.code} ${poster.error.detail ?? ''}`);
    expect(poster.value.url).toMatch(/\/poster\.jpg$/);
    const posterInfo = (await probeJson(ctx, fileOf(poster.value.url), 'stream=width,height')) as {
      streams: { width: number; height: number }[];
    };
    expect(posterInfo.streams[0]).toMatchObject({ width: 432, height: 768 });
    expect(
      nearestFrame(await patchColour(ctx, fileOf(poster.value.url), 0, { x: 200, y: 380, size: 8 })),
    ).toBe(0);

    const frame = await renderMediaUrl(world.deps, previews, {
      renderId: record.id,
      kind: 'frame',
      frame: 23,
    });
    if (!frame.ok) throw new Error(frame.error.code);
    expect(frame.value.url).toMatch(/\/frame-23\.jpg$/);
    const frameInfo = (await probeJson(ctx, fileOf(frame.value.url), 'stream=width,height')) as {
      streams: { width: number; height: number }[];
    };
    expect(frameInfo.streams[0]).toMatchObject({ width: 1080, height: 1920 });
    expect(
      nearestFrame(await patchColour(ctx, fileOf(frame.value.url), 0, { x: 500, y: 900, size: 8 })),
    ).toBe(23);

    const made = (await stat(fileOf(frame.value.url))).mtimeMs;
    const again = await renderMediaUrl(world.deps, previews, {
      renderId: record.id,
      kind: 'frame',
      frame: 23,
    });
    expect(again).toEqual(frame);
    expect((await stat(fileOf(frame.value.url))).mtimeMs).toBe(made);

    const past = await renderMediaUrl(world.deps, previews, {
      renderId: record.id,
      kind: 'frame',
      frame: 60,
    });
    expect(!past.ok && past.error.code).toBe('core.validation');
  });

  it('refuses a deleted render', async () => {
    const record = renderRecord(timeline, { filePath: file, deletedAt: 5 });
    await world.store.create(record);
    const refused = await renderMediaUrl(world.deps, previews, { renderId: record.id, kind: 'poster' });
    expect(!refused.ok && refused.error.code).toBe('core.not_found');
  });
});
