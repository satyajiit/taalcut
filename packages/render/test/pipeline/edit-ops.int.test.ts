// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS end to end, with the bundled FFmpeg and the pinned shell: a timeline the editor's commands made (a warm,
 * brighter clip, a crossfade into a plain one, a half-speed clip after it) renders with the grade's colour, which the
 * preview frame draws the same, the crossfade between the two, and the half-speed clip at its length.
 */
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FrameRate, NEUTRAL_GRADE, newId, RationalTime, type Timeline } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureFrame } from '../../src/engine/capture-frame';
import { renderVideo } from '../../src/engine/render-video';
import { applyMatrix, gradeMatrix } from '../../src/grade/clip-grade';
import { highlightChannel } from '../../src/grade/highlight-curve';
import { presetFor } from '../../src/presets/presets.v1';
import { fakeWorld } from '../router/fixtures';
import { colourClip, findTestMedia, mediaContext, patchColour, patchColours, probeJson, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';

const media = await findTestMedia('edit-ops');
const shell = findTestShell('edit-ops');
const rate = FrameRate.of(30);
const GRADE = { ...NEUTRAL_GRADE, exposure: 0.4, temperature: 0.6, highlights: -0.5, whites: -0.3 };

describe.skipIf(!media.binaries || !shell.path)('the editor’s edits, rendered', { timeout: 300_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let timeline: Timeline;
  let source: string;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('edit-ops');
    source = join(work.dir, 'grey.mp4');
    await colourClip(ctx, source, { colour: '0x806850', frames: 150, rate: '30', size: '540x960', tone: null });
    const assetId = newId<'Asset'>();
    const base = makeTimeline({
      rate,
      items: [
        { frames: 30, assetId, sourceStart: 20, mediaFrames: 150 },
        { frames: 30, assetId, sourceStart: 20, mediaFrames: 150, transition: { kind: 'dissolve', inFrames: 4, outFrames: 4 } },
        {
          frames: 30,
          assetId,
          sourceStart: 60,
          mediaFrames: 150,
          speed: { curve: 'hold', points: [{ at: RationalTime.of(0, rate), speed: 0.5 }, { at: RationalTime.of(30, rate), speed: 0.5 }] },
        },
      ],
    });
    const video = base.tracks[0]!;
    if (video.kind !== 'video') throw new Error('no V1');
    const items = video.items.map((item, index) => (index === 0 && item.type === 'clip' ? { ...item, grade: GRADE } : item));
    timeline = { ...base, tracks: [{ ...video, items }, ...base.tracks.slice(1)] };
  });
  afterAll(async () => work?.dispose());

  it('draws the grade in the export and the preview alike, the crossfade, and the half-speed clip', async () => {
    const info = await stat(source);
    const rendered = await renderVideo({
      timeline,
      preset: presetFor('device'),
      burnCaptions: false,
      source: () => ({ path: source, size: info.size, mtimeMs: info.mtimeMs }),
      ctx,
      conformDir: join(work.dir, 'conform'),
      workDir: join(work.dir, 'work'),
      chromePath: shell.path!,
      browserGpu: 'hardware',
      gpuEncode: true,
      workers: 'auto',
    });
    if (!rendered.ok) throw new Error(`${rendered.error.code}: ${rendered.error.detail ?? ''}`);
    const probe = (await probeJson(ctx, rendered.value.video, 'stream=nb_read_packets')) as {
      streams: { nb_read_packets: string }[];
    };
    expect(Number(probe.streams[0]!.nb_read_packets)).toBe(90);

    const colours = await patchColours(ctx, rendered.value.video, { x: 500, y: 900, size: 16 });
    const plain = colours[45]!;
    const expected = applyMatrix(gradeMatrix(GRADE), [plain[0] / 255, plain[1] / 255, plain[2] / 255]).map((v) => highlightChannel(v, GRADE) * 255);
    const graded = colours[10]!;
    graded.forEach((value, channel) => expect(Math.abs(value - expected[channel]!)).toBeLessThanOrEqual(8));
    expect(graded[0] - plain[0]).toBeGreaterThan(20);
    // Half way through the crossfade the picture is between the two.
    const middle = colours[30]!;
    expect(middle[0]).toBeLessThan(graded[0] - 5);
    expect(middle[0]).toBeGreaterThan(plain[0] + 5);
    // The half-speed clip is the plain colour, for its whole 30 frames.
    for (const frame of [60, 75, 89]) colours[frame]!.forEach((value, channel) => expect(Math.abs(value - plain[channel]!)).toBeLessThanOrEqual(6));

    const world = await fakeWorld(join(work.dir, 'world'), { ctx, shell: shell.path! });
    const first = timeline.tracks[0]!.kind === 'video' ? timeline.tracks[0]!.items[0] : undefined;
    if (first?.type !== 'clip') throw new Error('no first clip');
    world.originals.set(first.media.assetId, source);
    world.timelines.set(timeline.id, timeline);
    const shot = await captureFrame(world.deps, {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      frame: 10,
      source: { kind: 'preview' },
      maxDimension: 1920,
    });
    if (!shot.ok) throw new Error(`${shot.error.code} ${shot.error.detail ?? ''}`);
    const jpeg = join(work.dir, 'preview.jpg');
    await writeFile(jpeg, Buffer.from(shot.value.dataBase64, 'base64'));
    const preview = await patchColour(ctx, jpeg, 0, { x: 500, y: 900, size: 16 });
    preview.forEach((value, channel) => expect(Math.abs(value - graded[channel]!)).toBeLessThanOrEqual(10));
  });
});
