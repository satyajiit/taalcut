// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CVR2: a cover drawn from a HyperFrames composition over the video's real frames, through the real headless
 * shell, at each cover aspect. The pictures are named in the cover and read from the originals; the JPEG is the
 * cover's size; a composition that cannot be this cover is refused with what to change, never drawn another way.
 * TAALCUT_COVER_SAMPLES names a folder to keep the JPEGs in (to look at them).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FrameRate, newId, VIDEO_SIZES, type CoverPicture, type Timeline } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coverImage } from '../../src/cover/cover-image';
import type { RenderEngineDeps } from '../../src/engine/deps';
import { fakeWorld } from '../router/fixtures';
import { findTestMedia, mediaContext, patchColour, probeJson, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';
import { composedCover, compositionText, DAWN, DUSK, sceneClip, type ComposedSpec } from './composed-fixture';

const media = await findTestMedia('composed-cover');
const shell = findTestShell('composed-cover');
const samples = process.env.TAALCUT_COVER_SAMPLES;
const frame = (name: string, at: number): CoverPicture => ({ name, source: { kind: 'frame', frame: at } });

const SAMPLES: readonly (ComposedSpec & { file: string; lit: { x: number; y: number } })[] = [
  { file: 'poster-9x16.html', aspect: '9:16', pictures: [frame('hero', 20)], lit: { x: 730, y: 500 } },
  { file: 'split-16x9.html', aspect: '16:9', pictures: [frame('hero', 20)], lit: { x: 1440, y: 560 } },
  {
    file: 'duo-4x5.html',
    aspect: '4:5',
    pictures: [frame('dusk', 20), frame('dawn', 80)],
    lit: { x: 730, y: 150 },
  },
  { file: 'window-1x1.html', aspect: '1:1', pictures: [frame('hero', 20)], lit: { x: 690, y: 396 } },
];

describe.skipIf(!media.binaries || !shell.path)(
  'a cover drawn from its composition',
  { timeout: 600_000 },
  () => {
    let work: Awaited<ReturnType<typeof tempDir>>;
    let deps: RenderEngineDeps;
    let timeline: Timeline;
    const ctx = media.binaries ? mediaContext(media.binaries) : null;
    const draw = async (html: string, spec: ComposedSpec) => {
      const cover = await composedCover(work.dir, timeline.projectId, html, spec);
      return coverImage(deps, {
        projectId: timeline.projectId,
        timelineId: timeline.id,
        revision: timeline.revision,
        cover,
      });
    };

    beforeAll(async () => {
      work = await tempDir('composed-cover');
      const world = await fakeWorld(join(work.dir, 'world'), { ctx: ctx!, shell: shell.path! });
      deps = { ...world.deps, workspaceRoot: work.dir };
      const clips = [];
      for (const [name, scene] of [
        ['dusk', DUSK],
        ['dawn', DAWN],
      ] as const) {
        const assetId = newId<'Asset'>();
        const file = join(work.dir, `${name}.mp4`);
        await sceneClip(ctx!, file, scene);
        world.originals.set(assetId, file);
        world.proxies.set(assetId, file);
        clips.push({ frames: 60, assetId, sourceStart: 0, mediaFrames: 60 });
      }
      // A title on the video: the cover's picture is the footage, so these words are never on a cover.
      timeline = makeTimeline({
        rate: FrameRate.of(30),
        items: clips,
        texts: [{ start: 0, frames: 120, text: 'A TITLE ON THE VIDEO' }],
      });
      world.timelines.set(timeline.id, timeline);
      if (samples) await mkdir(samples, { recursive: true });
    });
    afterAll(async () => work?.dispose());

    it.each(SAMPLES)('draws $file at $aspect over the video’s frames', async (sample) => {
      const result = await draw(await compositionText(sample.file), sample);
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
      const size = VIDEO_SIZES[sample.aspect];
      expect(result.value).toMatchObject({ ...size, mimeType: 'image/jpeg', revision: timeline.revision });
      const file = join(samples ?? work.dir, sample.file.replace('.html', '.jpg'));
      await writeFile(file, Buffer.from(result.value.dataBase64, 'base64'));
      const probed = await probeJson(ctx!, file, 'stream=width,height,codec_name');
      expect((probed.streams as unknown[])[0]).toMatchObject({ ...size, codec_name: 'mjpeg' });
      // The picture is the footage: where the frame's sky is, the cover is lit, not the black under it.
      const [red, green, blue] = await patchColour(ctx!, file, 0, { ...sample.lit, size: 8 });
      expect(red + green + blue).toBeGreaterThan(150);
      expect(
        Object.fromEntries((result.value.checks ?? []).map((check) => [check.id, check.status])),
      ).toEqual({
        words: 'pass',
        typeFloor: 'pass',
        safeArea: 'pass',
        pictures: 'pass',
        marks: 'pass',
      });
    });

    it('fills its words from the cover’s values, and says when they leave the canvas', async () => {
      const html = await compositionText('poster-9x16.html');
      const result = await draw(html, {
        aspect: '9:16',
        pictures: [frame('hero', 20)],
        params: { headline: 'Incomprehensibilities' },
      });
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
      const words = result.value.checks?.find((check) => check.id === 'words');
      expect(words?.status).toBe('fail');
      expect(words?.detail).toContain('"Incomprehensibilities" runs');
      expect(words?.detail).toContain('past the right edge');
    });

    it('refuses a composition that is not this cover, with what to change', async () => {
      const html = await compositionText('poster-9x16.html');
      const wide = await draw(html, { aspect: '16:9', pictures: [frame('hero', 20)] });
      expect(!wide.ok && wide.error.code).toBe('core.validation');
      expect(!wide.ok && wide.error.detail).toContain('is 1080×1920 and a 16:9 cover is 1920×1080');

      const unnamed = await draw(html, { aspect: '9:16', pictures: [] });
      expect(!unnamed.ok && unnamed.error.detail).toContain(
        '<img data-picture="hero"> names a picture the cover does not state',
      );

      const idle = await draw(html, { aspect: '9:16', pictures: [frame('hero', 20), frame('spare', 30)] });
      expect(!idle.ok && idle.error.detail).toContain('"spare" is stated and no <img data-picture="spare">');

      const gone = await draw(html, {
        aspect: '9:16',
        pictures: [{ name: 'hero', source: { kind: 'asset', assetId: newId<'Asset'>(), seconds: 0 } }],
      });
      expect(!gone.ok && gone.error.code).toBe('core.not_found');

      const late = await draw(html, { aspect: '9:16', pictures: [frame('hero', 4000)] });
      expect(!late.ok && late.error.detail).toContain(
        'the picture "hero" names frame 4000, which is not in the video',
      );

      const scripted = await draw(html.replace('<div id="ground"></div>', '<iframe></iframe>'), {
        aspect: '9:16',
        pictures: [frame('hero', 20)],
      });
      expect(!scripted.ok && scripted.error.detail).toContain('does not pass the gate');
    });

    it('holds a footage cover to its footage: a stamp of a picture and drawn scenery are said', async () => {
      const html = await compositionText('poster-9x16.html');
      const stamp = await draw(
        html.replace(
          'inset: 0;\n          width: 100%;\n          height: 100%;',
          'width: 300px;\n          height: 300px;',
        ),
        { aspect: '9:16', pictures: [frame('hero', 20)] },
      );
      if (!stamp.ok) throw new Error(`${stamp.error.code}: ${stamp.error.detail}`);
      const pictures = stamp.value.checks?.find((check) => check.id === 'pictures');
      expect(pictures?.status).toBe('fail');
      expect(pictures?.detail).toMatch(/cover \d% of the cover, under 30%/);

      const shapes = Array.from(
        { length: 10 },
        (_, n) => `<rect x="${n * 40}" y="0" width="30" height="30" fill="#ffffff" />`,
      ).join('');
      const drawn = await draw(
        html.replace(
          '<div id="ground"></div>',
          `<div id="ground"></div><svg id="scenery" viewBox="0 0 400 30">${shapes}</svg>`,
        ),
        { aspect: '9:16', pictures: [frame('hero', 20)] },
      );
      if (!drawn.ok) throw new Error(`${drawn.error.code}: ${drawn.error.detail}`);
      expect(drawn.value.checks?.find((check) => check.id === 'marks')).toMatchObject({ status: 'fail' });
      // The same shapes on a cover the person asked to be drawn are that cover's own business.
      const asked = await draw(
        html.replace(
          '<div id="ground"></div>',
          `<div id="ground"></div><svg id="scenery" viewBox="0 0 400 30">${shapes}</svg>`,
        ),
        { aspect: '9:16', pictures: [frame('hero', 20)], medium: 'drawn' },
      );
      expect(asked.ok && asked.value.checks?.find((check) => check.id === 'marks')?.status).toBe('pass');
    });
  },
);
