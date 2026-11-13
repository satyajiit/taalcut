// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * captureFrame end to end with the bundled FFmpeg and the pinned shell: a
 * preview frame drawn by the composition from stills, the boxes Chrome laid
 * the caption and the title out in, the preset layer, and frame k decoded
 * exactly from a render's file.
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FrameRate, newId, type CaptureFrameInput, type Timeline } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureFrame } from '../../src/engine/capture-frame';
import { renderWorkFile } from '../../src/store/paths';
import { colourClip, ffmpeg, findTestMedia, mediaContext, patchColour, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { captionTrackOf, makeTimeline } from '../support/timeline';
import { fakeWorld, renderRecord, type FakeWorld } from '../router/fixtures';
import { FIXTURE_H264 } from '../support/host-video';

const media = await findTestMedia('capture-frame');
const shell = findTestShell('capture-frame');
const rate = FrameRate.of(30);
/** geq colour of frame n in the "render" fixture, as in the frame oracle. */
const colourOf = (n: number) => [(n * 37 + 20) % 256, (n * 91 + 40) % 256, (n * 53 + 60) % 256];

describe.skipIf(!media.binaries || !shell.path)('captureFrame', { timeout: 240_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let world: FakeWorld;
  let timeline: Timeline;

  const jpegColour = async (dataBase64: string, x: number, y: number) => {
    const file = join(work.dir, `${newId()}.jpg`);
    await writeFile(file, Buffer.from(dataBase64, 'base64'));
    return patchColour(ctx, file, 0, { x, y, size: 8 });
  };
  const input = (overrides: Partial<CaptureFrameInput>): CaptureFrameInput => ({
    projectId: timeline.projectId,
    timelineId: timeline.id,
    frame: 5,
    source: { kind: 'preview' },
    ...overrides,
  });

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('capture-frame');
    world = await fakeWorld(join(work.dir, 'world'), { ctx, shell: shell.path! });
    const red = newId<'Asset'>();
    const blue = newId<'Asset'>();
    for (const [asset, colour] of [
      [red, 'red'],
      [blue, 'blue'],
    ] as const) {
      const file = join(work.dir, `${colour}.mp4`);
      await colourClip(ctx, file, { colour, frames: 60, rate: '30', size: '540x960', tone: null });
      world.originals.set(asset, file);
    }
    timeline = makeTimeline({
      rate,
      items: [
        { frames: 30, assetId: red, sourceStart: 0, mediaFrames: 60 },
        { frames: 30, assetId: blue, sourceStart: 0, mediaFrames: 60 },
      ],
      texts: [{ start: 0, frames: 60, text: 'Hello' }],
      captions: captionTrackOf(rate, [[0, 60, 'hello world']]),
    });
    world.timelines.set(timeline.id, timeline);
  });
  afterAll(async () => work?.dispose());

  it('captures a preview frame drawn by the composition, with Chrome’s text boxes', async () => {
    const shot = await captureFrame(world.deps, input({ maxDimension: 768 }));
    if (!shot.ok) throw new Error(`${shot.error.code} ${shot.error.detail ?? ''}`);
    expect(shot.value).toMatchObject({
      frame: 5,
      mimeType: 'image/jpeg',
      width: 432,
      height: 768,
      at: { value: 5 },
    });
    expect(shot.value.visible).toEqual({
      clips: [timeline.tracks[0]!.items[0]!.id],
      captions: [timeline.captions!.cues[0]!.id],
      texts: [expect.any(String)],
    });
    const [r, g, b] = await jpegColour(shot.value.dataBase64, 216, 700);
    expect(r).toBeGreaterThan(200);
    expect(g + b).toBeLessThan(80);
    const caption = shot.value.textBoxes.find((box) => box.kind === 'caption');
    const title = shot.value.textBoxes.find((box) => box.kind === 'text');
    expect(caption).toMatchObject({ id: timeline.captions!.cues[0]!.id, lines: 1, inSafeZone: true });
    // The title's glyphs, centred in its box from y 384 (0.2 of the canvas): the text, not the element.
    expect(title).toMatchObject({ lines: 1, inSafeZone: true });
    expect(title!.box.y).toBeGreaterThanOrEqual(370);
    expect(title!.box.y).toBeLessThan(576);
    expect(title!.box.width).toBeLessThan(400);

    const later = await captureFrame(world.deps, input({ frame: 45, maxDimension: 768 }));
    if (!later.ok) throw new Error(later.error.code);
    const [r2, , b2] = await jpegColour(later.value.dataBase64, 216, 700);
    expect(b2).toBeGreaterThan(200);
    expect(r2).toBeLessThan(60);
  });

  it('draws the preset’s platform overlays over the picture', async () => {
    const plain = await captureFrame(world.deps, input({ maxDimension: 768 }));
    const layered = await captureFrame(world.deps, input({ maxDimension: 768, overlayPresetId: 'shorts' }));
    if (!plain.ok || !layered.ok) throw new Error('capture failed');
    const [plainRed] = await jpegColour(plain.value.dataBase64, 216, 40);
    const [layeredRed] = await jpegColour(layered.value.dataBase64, 216, 40);
    expect(plainRed - layeredRed).toBeGreaterThan(50);
  });

  it('decodes frame k of a render’s file exactly', async () => {
    const file = join(work.dir, 'render.mp4');
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'nullsrc=s=216x384:r=30:d=2',
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
    const record = renderRecord(timeline, { filePath: file, durationFrames: 60 });
    await world.store.create(record);
    const shot = await captureFrame(
      world.deps,
      input({ frame: 17, source: { kind: 'render', renderId: record.id }, maxDimension: 1920 }),
    );
    if (!shot.ok) throw new Error(`${shot.error.code} ${shot.error.detail ?? ''}`);
    const colour = await jpegColour(shot.value.dataBase64, 500, 900);
    const distance = (n: number) =>
      colourOf(n).reduce((sum, value, index) => sum + (value - colour[index]!) ** 2, 0);
    const nearest = Array.from({ length: 60 }, (_, n) => n).sort((a, b) => distance(a) - distance(b))[0];
    expect(nearest).toBe(17);
    // Same revision as the render: the boxes come from the still bundle.
    expect(shot.value.textBoxes.map((box) => box.kind).sort()).toEqual(['caption', 'text']);
    // FIX-QA: a draft whose QA failed keeps its file in the work folder, and the Reviewer looks at that one.
    const draft = renderRecord(timeline, { status: 'needsAttention', filePath: null, durationFrames: 60 });
    await world.store.create(draft);
    const ask = input({ frame: 17, source: { kind: 'render', renderId: draft.id } });
    const gone = await captureFrame(world.deps, ask);
    expect(!gone.ok && gone.error.code).toBe('render.not_ready');
    const kept = renderWorkFile(world.deps.folders, draft.id);
    await mkdir(dirname(kept), { recursive: true });
    await copyFile(file, kept);
    const drafted = await captureFrame(world.deps, ask);
    if (!drafted.ok) throw new Error(`${drafted.error.code} ${drafted.error.detail ?? ''}`);
    expect(drafted.value.frame).toBe(17);
  });

  it('refuses a render that has no file, a frame past the end and a stale revision', async () => {
    const queued = renderRecord(timeline, { status: 'rendering' });
    await world.store.create(queued);
    const notReady = await captureFrame(
      world.deps,
      input({ source: { kind: 'render', renderId: queued.id } }),
    );
    expect(!notReady.ok && notReady.error.code).toBe('render.not_ready');
    const past = await captureFrame(world.deps, input({ frame: 60 }));
    expect(!past.ok && past.error.code).toBe('core.validation');
    const stale = await captureFrame(world.deps, input({ timelineRevision: timeline.revision + 1 }));
    expect(!stale.ok && stale.error.code).toBe('core.conflict');
    // Platform overlays are portrait apps' UI: landscape has none to draw (P3-V2's presets are built).
    const landscape = await captureFrame(world.deps, input({ overlayPresetId: 'landscape' }));
    expect(!landscape.ok && landscape.error.code).toBe('core.validation');
  });
});
