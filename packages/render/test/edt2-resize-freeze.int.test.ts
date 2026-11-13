// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  coverSettingsSchema,
  FrameRate,
  NEUTRAL_GRADE,
  newId,
  RationalTime,
  timelineSchema,
  unwrap,
  VIDEO_SIZES,
} from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCompositionFonts } from '../src/captions/fonts';
import { layoutCue } from '../src/captions/layout';
import { coverImage } from '../src/cover/cover-image';
import { captureFrame } from '../src/engine/capture-frame';
import { createPreviewSessions } from '../src/engine/previews';
import { renderVideo } from '../src/engine/render-video';
import { applyMatrix, gradeMatrix } from '../src/grade/clip-grade';
import { canvasPreset } from '../src/presets/canvas-preset';
import { presetFor } from '../src/presets/presets.v1';
import { fakeWorld, type FakeWorld } from './router/fixtures';
import { FIXTURE_H264 } from './support/host-video';
import { FONTS_DIR, testMeasurer } from './support/fonts';
import { ffmpeg, findTestMedia, mediaContext, patchColour, probeJson, tempDir } from './support/media';
import { findTestShell } from './support/shell';
import { captionTrackOf, makeTimeline } from './support/timeline';

const media = await findTestMedia('edt2-resize-freeze');
const shell = findTestShell('edt2-resize-freeze');
const rate = FrameRate.of(30);
const grade = { ...NEUTRAL_GRADE, exposure: 0.3, temperature: 0.25 };

describe.skipIf(!media.binaries || !shell.path)(
  'EDT2 saved canvas and graded freeze across render surfaces',
  { timeout: 300_000 },
  () => {
    const ctx = media.binaries ? mediaContext(media.binaries) : null;
    let work: Awaited<ReturnType<typeof tempDir>>;
    let world: FakeWorld;
    let source: string;
    const assetId = newId<'Asset'>();

    beforeAll(async () => {
      work = await tempDir('edt2-resize-freeze');
      source = join(work.dir, 'numbered.mp4');
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
        source,
      ]);
      world = await fakeWorld(join(work.dir, 'world'), { ctx: ctx!, shell: shell.path! });
      world.originals.set(assetId, source);
    });
    afterAll(async () => work?.dispose());

    it.each(Object.entries(VIDEO_SIZES))(
      '%s keeps preview, captured frame and encoded canvas equal, with one grade and caption',
      async (aspect, size) => {
        const timeline = makeTimeline({
          rate,
          items: [{ frames: 12, assetId, sourceStart: 17, mediaFrames: 60, muted: true }],
          captions: captionTrackOf(rate, [[0, 12, 'HELD']]),
          texts: [{ start: 0, frames: 12, text: 'TITLE', reveal: 'none' }],
        });
        timeline.canvas = { ...size, rate };
        const clip = timeline.tracks[0]!.items[0]!;
        if (clip.type !== 'clip') throw new Error('Expected video clip');
        clip.holdFrame = RationalTime.of(17, rate);
        clip.grade = grade;
        world.timelines.set(timeline.id, timelineSchema.parse(timeline));
        const previews = createPreviewSessions(world.deps, { audio: false });
        try {
          const preview = unwrap(await previews.open(timeline.projectId, timeline.id));
          expect(preview).toMatchObject({ ...size, timelineRevision: timeline.revision });
          const info = await stat(source);
          const measurer = await testMeasurer();
          const rendered = unwrap(
            await renderVideo({
              timeline,
              preset: canvasPreset(presetFor('device'), timeline.canvas),
              burnCaptions: true,
              source: () => ({ path: source, size: info.size, mtimeMs: info.mtimeMs }),
              ctx: ctx!,
              conformDir: join(work.dir, `${aspect}-conform`),
              workDir: join(work.dir, `${aspect}-render`),
              chromePath: shell.path!,
              browserGpu: 'hardware',
              gpuEncode: true,
              workers: 1,
              fonts: createCompositionFonts(FONTS_DIR, measurer),
              captionLayout: (text, style, safe, language, canvasHeight) =>
                layoutCue(text, style, measurer, safe, language, canvasHeight),
            }),
          );
          const probe = await probeJson(ctx!, rendered.video, 'stream=width,height,nb_read_packets');
          expect(probe).toMatchObject({ streams: [{ ...size, nb_read_packets: '12' }] });
          // The sample is below both text layers; a second grade is measurably different here.
          const patch = { x: Math.floor(size.width / 2), y: Math.floor(size.height * 0.9), size: 8 };
          const original = await patchColour(ctx!, source, 17, { x: 100, y: 300, size: 8 });
          const expected = applyMatrix(
            gradeMatrix(grade),
            original.map((v) => v / 255) as [number, number, number],
          );
          for (const frame of [0, 11]) {
            const capture = unwrap(
              await captureFrame(world.deps, {
                projectId: timeline.projectId,
                timelineId: timeline.id,
                frame,
                timelineRevision: timeline.revision,
                source: { kind: 'preview' },
                original: true,
                maxDimension: 1920,
              }),
            );
            expect(capture).toMatchObject(size);
            expect(capture.textBoxes.filter((box) => box.kind === 'caption')).toHaveLength(1);
            expect(capture.textBoxes.filter((box) => box.kind === 'text')).toHaveLength(1);
            const jpeg = join(work.dir, `${aspect}-${frame}.jpg`);
            await writeFile(jpeg, Buffer.from(capture.dataBase64, 'base64'));
            const captured = await patchColour(ctx!, jpeg, 0, patch);
            const exported = await patchColour(ctx!, rendered.video, frame, patch);
            for (let channel = 0; channel < 3; channel++) {
              expect(Math.abs(captured[channel]! - expected[channel]! * 255)).toBeLessThanOrEqual(12);
              expect(Math.abs(exported[channel]! - captured[channel]!)).toBeLessThanOrEqual(12);
            }
          }
        } finally {
          await previews.closeAll();
        }
      },
    );

    it('caches only the held original pixels, leaving grading and both text layers editable', async () => {
      const timeline = makeTimeline({
        rate,
        items: [{ frames: 12, assetId, sourceStart: 17, mediaFrames: 60, muted: true }],
        captions: captionTrackOf(rate, [[0, 12, 'HELD']]),
        texts: [{ start: 0, frames: 12, text: 'TITLE', reveal: 'none' }],
      });
      const clip = timeline.tracks[0]!.items[0]!;
      if (clip.type !== 'clip') throw new Error('Expected video clip');
      clip.holdFrame = RationalTime.of(17, rate);
      clip.grade = grade;
      world.timelines.set(timeline.id, timeline);
      const previews = createPreviewSessions(world.deps, { audio: false });
      try {
        const preview = unwrap(await previews.open(timeline.projectId, timeline.id));
        const token = new URL(preview.url).pathname.split('/')[1]!;
        const folder = join(world.deps.folders.preview, token);
        const cached = (await readdir(folder)).filter((file) => /^hold-.*\.png$/.test(file));
        expect(cached).toHaveLength(1);
        for (const y of [90, 210, 300]) {
          const patch = { x: 100, y, size: 8 };
          const original = await patchColour(ctx!, source, 17, patch);
          const held = await patchColour(ctx!, join(folder, cached[0]!), 0, patch);
          held.forEach((value, channel) =>
            expect(Math.abs(value - original[channel]!)).toBeLessThanOrEqual(4),
          );
        }
      } finally {
        await previews.closeAll();
      }
    });

    it('renders the same full-resolution cover after serializing and reopening its saved design', async () => {
      const timeline = makeTimeline({
        rate,
        items: [{ frames: 60, assetId, sourceStart: 0, mediaFrames: 60 }],
      });
      const cover = coverSettingsSchema.parse({
        aspect: '4:5',
        source: { kind: 'frame', frame: 17 },
        hookText: 'Saved words',
        kickerText: 'A label',
        textAlign: 'left',
        theme: 'midnight',
        archetype: 'brutal-slab',
        channel: { name: 'Channel', handle: '@creator', show: true },
      });
      world.timelines.set(timeline.id, timeline);
      const target = { projectId: timeline.projectId, timelineId: timeline.id, revision: 1 };
      const draft = unwrap(await coverImage(world.deps, { ...target, cover }));
      world.timelines.set(
        timeline.id,
        timelineSchema.parse(JSON.parse(JSON.stringify({ ...timeline, covers: [cover] }))),
      );
      const reopened = unwrap(await coverImage(world.deps, { ...target, aspect: '4:5' }));
      expect(reopened).toMatchObject({ width: 1080, height: 1350, revision: 1 });
      expect(reopened.dataBase64).toBe(draft.dataBase64);
    });
  },
);
