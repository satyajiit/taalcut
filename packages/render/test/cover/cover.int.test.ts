// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  coverSettingsSchema,
  FrameRate,
  newId,
  RationalTime,
  VIDEO_SIZES,
  type Timeline,
} from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coverImage } from '../../src/cover/cover-image';
import { captureFrame } from '../../src/engine/capture-frame';
import { planTimeline } from '../../src/plan/render-plan';
import { makeTimeline } from '../support/timeline';
import { fakeWorld, type FakeWorld } from '../router/fixtures';
import { colourClip, ffmpeg, findTestMedia, mediaContext, patchColour, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { airportDesign } from './authored-fixture';
import { FIXTURE_H264 } from '../support/host-video';

const media = await findTestMedia('editor-cover');
const shell = findTestShell('editor-cover');
const rate = FrameRate.of(30);
const colourOf = (n: number) => [(n * 37 + 20) % 256, (n * 91 + 40) % 256, (n * 53 + 60) % 256];

describe.skipIf(!media.binaries || !shell.path)(
  'full-resolution covers and held frames',
  { timeout: 240_000 },
  () => {
    let work: Awaited<ReturnType<typeof tempDir>>;
    let world: FakeWorld;
    let timeline: Timeline;
    const ctx = media.binaries ? mediaContext(media.binaries) : null;
    beforeAll(async () => {
      work = await tempDir('editor-cover');
      world = await fakeWorld(join(work.dir, 'world'), { ctx: ctx!, shell: shell.path! });
      const assetId = newId<'Asset'>();
      const original = join(work.dir, 'original.mp4');
      const proxy = join(work.dir, 'proxy.mp4');
      await colourClip(ctx!, original, {
        colour: 'red',
        frames: 60,
        rate: '30',
        size: '1080x1920',
        tone: null,
      });
      await colourClip(ctx!, proxy, { colour: 'blue', frames: 60, rate: '30', size: '270x480', tone: null });
      world.originals.set(assetId, original);
      world.proxies.set(assetId, proxy);
      timeline = makeTimeline({ rate, items: [{ frames: 60, assetId, sourceStart: 0, mediaFrames: 60 }] });
      world.timelines.set(timeline.id, timeline);
    });
    afterAll(async () => work?.dispose());

    it.each(Object.keys(VIDEO_SIZES) as (keyof typeof VIDEO_SIZES)[])(
      'exports %s from the original, at the saved dimensions',
      async (aspect) => {
        const cover = coverSettingsSchema.parse({
          aspect,
          source: { kind: 'frame', frame: 17 },
          archetype: 'atmospheric-cinema',
        });
        world.timelines.set(timeline.id, { ...timeline, covers: [cover] });
        const result = await coverImage(world.deps, {
          projectId: timeline.projectId,
          timelineId: timeline.id,
          revision: timeline.revision,
        });
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
        expect(result.value).toMatchObject(VIDEO_SIZES[aspect]);
        const file = join(work.dir, `${aspect.replace(':', '-')}.jpg`);
        await writeFile(file, Buffer.from(result.value.dataBase64, 'base64'));
        const [red, green, blue] = await patchColour(ctx!, file, 0, { x: 500, y: 500, size: 8 });
        expect(red).toBeGreaterThan(200);
        expect(green + blue).toBeLessThan(80);
      },
    );

    it('renders a solid authored graphic cover through the same full-resolution JPEG service without reading footage', async () => {
      const cover = coverSettingsSchema.parse({
        aspect: '9:16',
        source: { kind: 'solid' },
        design: airportDesign(),
      });
      world.timelines.set(timeline.id, { ...timeline, covers: [cover] });
      const result = await coverImage(
        {
          ...world.deps,
          assets: {
            ...world.deps.assets,
            original: async () => {
              throw new Error('Solid design must not read footage');
            },
          },
        },
        { projectId: timeline.projectId, timelineId: timeline.id, revision: timeline.revision },
      );
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
      expect(result.value).toMatchObject({
        width: 1080,
        height: 1920,
        revision: timeline.revision,
        mimeType: 'image/jpeg',
      });
      const file = join(work.dir, 'authored.jpg');
      await writeFile(file, Buffer.from(result.value.dataBase64, 'base64'));
      const [red, green, blue] = await patchColour(ctx!, file, 0, { x: 200, y: 823, size: 4 });
      expect(red).toBeGreaterThan(220);
      expect(green).toBeGreaterThan(90);
      expect(green).toBeLessThan(145);
      expect(blue).toBeLessThan(55);
    });

    it('rejects text that cannot fit instead of exporting clipped authored lettering', async () => {
      const design = airportDesign();
      design.layers[0]!.box = { x: 0.1, y: 0.1, width: 0.001, height: 0.001 };
      const cover = coverSettingsSchema.parse({ aspect: '9:16', source: { kind: 'solid' }, design });
      const result = await coverImage(world.deps, {
        projectId: timeline.projectId,
        timelineId: timeline.id,
        revision: timeline.revision,
        cover,
      });
      expect(!result.ok && result.error.code).toBe('core.validation');
      expect(!result.ok && result.error.detail).toContain('Enlarge the box');
    });

    it('holds source frame 17 at both ends without playing source audio or baking overlays into the source', async () => {
      const file = join(work.dir, 'numbered.mp4');
      await ffmpeg(ctx!, [
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
      const assetId = newId<'Asset'>();
      world.originals.set(assetId, file);
      const held = makeTimeline({
        rate,
        items: [{ frames: 60, assetId, sourceStart: 17, mediaFrames: 120 }],
      });
      const clip = held.tracks[0]!.items[0]!;
      if (clip.type !== 'clip') throw new Error('Expected clip');
      clip.holdFrame = RationalTime.of(17, rate);
      clip.speed = null;
      clip.audio = { muted: true, gainDb: 0 };
      world.timelines.set(held.id, held);
      const plan = planTimeline(held);
      expect(plan.ok && plan.value.audio.length).toBe(0);
      for (const frame of [0, 59]) {
        const shot = await captureFrame(world.deps, {
          projectId: held.projectId,
          timelineId: held.id,
          frame,
          source: { kind: 'preview' },
          original: true,
          maxDimension: 768,
        });
        if (!shot.ok) throw new Error(`${shot.error.code}: ${shot.error.detail}`);
        const jpeg = join(work.dir, `held-${frame}.jpg`);
        await writeFile(jpeg, Buffer.from(shot.value.dataBase64, 'base64'));
        const actual = await patchColour(ctx!, jpeg, 0, { x: 216, y: 500, size: 8 });
        const distance = (n: number) =>
          colourOf(n).reduce((sum, value, index) => sum + (value - actual[index]!) ** 2, 0);
        expect(Array.from({ length: 60 }, (_, n) => n).sort((a, b) => distance(a) - distance(b))[0]).toBe(17);
      }
    });
  },
);
