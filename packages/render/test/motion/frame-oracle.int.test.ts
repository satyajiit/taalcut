// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The frame oracle (SPEC G.2, G.9): a timeline using every kind of motion, compiled for export and for preview.
 * The export is seeked through the producer's capture session (the export's own seek path) and the preview through
 * HyperFrames' runtime `__player.seek` (what `<hyperframes-player>` calls), served as main's preview handler
 * serves it. At chosen frames every animated element's state is the same in both, a second export session gives
 * the same again, and chosen values equal the ones GSAP's own eases give in Node for the motion data.
 */
import type { Server } from 'node:http';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrap } from '@taalcut/core';
import { openCaptureSession, type CaptureHandle } from '../../src/engine/capture';
import { producerRuntimeScript } from '../../src/engine/producer';
import { easeFunction } from '../../src/motion/eases';
import type { MotionPart, MotionTween } from '../../src/motion/motion-data';
import { presetFor } from '../../src/presets/presets.v1';
import { findTestMedia, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { inlineStyle, MOTION_STATE, serveDir, writeMotionBundle } from './page-support';
import { motionTimeline } from './support';

const media = await findTestMedia('motion frame oracle');
const shell = findTestShell('motion frame oracle');

/** Frames across the titles' reveals (20, 150, 300), the slide (120), the whip (360) and the caption pops. */
const FRAMES = [
  0, 4, 9, 14, 22, 30, 45, 60, 74, 76, 80, 90, 100, 116, 119, 120, 122, 126, 150, 153, 166, 175, 200, 240,
  241, 250, 262, 280, 300, 303, 330, 340, 357, 360, 363, 380, 405, 420, 440, 480, 486, 500, 540, 547, 560,
  575, 599,
];

type State = Record<string, string>;

const motionOf = (html: string): MotionPart => {
  const json = /<script type="application\/json" id="tc-data">([^<]*)<\/script>/.exec(html)?.[1] ?? '{}';
  return (JSON.parse(json) as { motion: MotionPart }).motion;
};

/** The value a one-property tween gives at `seconds`, by GSAP's own ease in Node. */
function expected(tween: MotionTween, seconds: number, read: (value: unknown) => number): number {
  const progress = Math.min(1, Math.max(0, (seconds - tween.at) / tween.duration));
  const value = (vars: MotionTween['from']) => {
    const only = Object.values(vars)[0];
    return typeof only === 'number' ? only : read(only);
  };
  const from = value(tween.from);
  return from + (value(tween.to) - from) * easeFunction(tween.ease)(progress);
}

const numberAt = (pattern: RegExp) => (value: unknown) =>
  Number(pattern.exec(String(value))?.[1] ?? Number.NaN);

describe.skipIf(!media.binaries || !shell.path)(
  'motion frame oracle (SPEC G.2)',
  { timeout: 900_000 },
  () => {
    let work: Awaited<ReturnType<typeof tempDir>>;
    let exportDir: string;
    let motion: MotionPart;
    let browser: Browser;
    let preview: Page;
    let server: Server;
    const sessions: CaptureHandle[] = [];

    const open = async () => {
      const preset = presetFor('device');
      const session = unwrap(
        await openCaptureSession({
          dir: exportDir,
          rate: { num: 30, den: 1 },
          width: preset.width,
          height: preset.height,
          chromePath: shell.path ?? '',
          browserGpu: 'software',
          binaries: { ffmpeg: media.binaries?.ffmpeg ?? '', ffprobe: media.binaries?.ffprobe ?? '' },
        }),
      );
      sessions.push(session);
      return session;
    };
    const exportState = async (session: CaptureHandle, frame: number) =>
      unwrap(await session.evaluateAt(frame, MOTION_STATE)) as State;
    const previewState = async (frame: number): Promise<State> => {
      await preview.evaluate(`void window.__player.seek(${frame / 30})`);
      await preview.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      return preview.evaluate(MOTION_STATE) as Promise<State>;
    };

    beforeAll(async () => {
      work = await tempDir('motion-oracle');
      const { timeline } = await motionTimeline();
      exportDir = join(work.dir, 'export');
      const exported = await writeMotionBundle(timeline, exportDir, 'export');
      motion = motionOf(exported.files['index.html'] ?? '');
      const runtime = await producerRuntimeScript();
      await writeMotionBundle(timeline, join(work.dir, 'preview'), 'preview', {
        runtimeScript: { file: runtime, key: 'runtime' },
      });
      ({ server, url: previewUrl } = await serveDir(join(work.dir, 'preview')));
      // Text laid out as the export's Chrome lays it out: HyperFrames launches with hinting off, which on Linux moves
      // glyph advances (FreeType hints them; 92.5 against 92.5625 px for one word). The app's preview needs the same
      // switch on Linux (LNX1-RND request to the desktop lane); on a Mac it changes nothing.
      browser = await puppeteer.launch({
        executablePath: shell.path,
        headless: true,
        args: ['--font-render-hinting=none'],
      });
      preview = await browser.newPage();
      await preview.setViewport({ width: 1080, height: 1920 });
      await preview.goto(previewUrl);
      await preview.waitForFunction(
        'Boolean(window.__playerReady && window.__player && window.__timelines && window.__timelines.taalcut)',
        { timeout: 30_000 },
      );
    });
    let previewUrl = '';

    afterAll(async () => {
      for (const session of sessions) await session.close();
      await browser?.close();
      server?.close();
      await work?.dispose();
    });

    it('the export and the preview draw every animated element alike at every chosen frame', async () => {
      const session = await open();
      let compared = 0;
      for (const frame of FRAMES) {
        const exported = await exportState(session, frame);
        const previewed = await previewState(frame);
        const shared = Object.keys(exported).filter((key) => key in previewed);
        // Every element the motion names is drawn in both.
        for (const tween of motion.tweens)
          if ('ids' in tween.targets) for (const id of tween.targets.ids) expect(shared, id).toContain(id);
        for (const key of shared) expect(previewed[key], `${key} at ${frame}`).toBe(exported[key]);
        compared += shared.length;
      }
      expect(compared).toBeGreaterThan(FRAMES.length * 30);
    });

    it('a second export session draws the same as the first', async () => {
      const [first] = sessions;
      const second = await open();
      if (!first) throw new Error('first session missing');
      for (const frame of FRAMES.filter((_, index) => index % 3 === 0))
        expect(await exportState(second, frame), `frame ${frame}`).toEqual(await exportState(first, frame));
    });

    it('values equal the ones GSAP’s own eases give for the motion data', async () => {
      const [session] = sessions;
      if (!session) throw new Error('session missing');
      const moving = motion.tweens.filter(
        (tween) => tween.duration > 0 && 'ids' in tween.targets && !tween.stagger,
      );
      const find = (property: string, ease: string) =>
        moving.find((tween) => Object.keys(tween.to).join() === property && tween.ease?.startsWith(ease));
      // A title typed on (linear), a clip sliding on a CSS curve (CustomEase), a title popping in on the same curve:
      // GSAP's own eases, read back from the inline style GSAP wrote. HFW1 retire: the kit's overshoots (back.out)
      // went with its graphics; a composition's own eases are its HyperFrames timeline's.
      const checks = [
        { tween: find('clipPath', 'none'), css: 'clip-path', read: numberAt(/inset\([^ ]+ (-?[\d.]+)%/) },
        {
          tween: find('xPercent', 'cubic-bezier'),
          css: 'transform',
          read: numberAt(/translate\((-?[\d.]+)%/),
        },
        { tween: find('scale', 'cubic-bezier'), css: 'transform', read: numberAt(/scale\((-?[\d.]+)/) },
      ];
      for (const { tween, css, read } of checks) {
        if (!tween) throw new Error(`no ${css} tween to check`);
        const id = 'ids' in tween.targets ? (tween.targets.ids[0] ?? '') : '';
        const first = Math.ceil(tween.at * 30) + 1;
        const last = Math.floor((tween.at + tween.duration) * 30) - 1;
        expect(last, `${id} ${css} runs over frames`).toBeGreaterThan(first);
        for (let frame = first; frame <= last; frame++) {
          const drawn = read(unwrap(await session.evaluateAt(frame, inlineStyle(id, css))));
          expect(drawn, `${id} ${css} at ${frame}`).toBeCloseTo(expected(tween, frame / 30, read), 2);
        }
      }
    });
  },
);
