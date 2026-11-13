// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { coverSettingsSchema, VIDEO_SIZES, type ThumbnailAspect } from '@taalcut/core';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coverBundle } from '../../src/cover/cover-bundle';
import { writeBundle } from '../../src/engine/bundle-writer';
import { FONTS_DIR } from '../support/fonts';
import { findTestShell } from '../support/shell';
import { airportDesign } from './authored-fixture';

const shell = findTestShell('authored-cover-layout');
const measurements = `(() => ({
  layers:[...document.querySelectorAll('.design-layer')].map(e => {
    const r=e.getBoundingClientRect(), s=getComputedStyle(e);
    return {x:r.x,y:r.y,width:r.width,height:r.height,scrollHeight:e.scrollHeight,
      clientHeight:e.clientHeight,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,
      size:parseFloat(s.fontSize),fill:s.backgroundColor,font:s.fontFamily};
  }), duplicatePreset:!!document.querySelector('.safe'),
  path:document.querySelector('.design-path path')?.getAttribute('d')
}))()`;

describe.skipIf(!shell.path)('authored cover composition in the pinned browser', () => {
  let browser: Browser;
  let page: Page;
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-authored-cover-'));
    browser = await puppeteer.launch({ executablePath: shell.path!, headless: true });
    page = await browser.newPage();
  });
  afterAll(async () => {
    await browser?.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function draw(aspect: ThumbnailAspect, longText = false) {
    const design = airportDesign();
    if (longText && design.layers[0]?.kind === 'text')
      design.layers[0].text = 'A longer title after the creator edits the airport story';
    const cover = coverSettingsSchema.parse({
      aspect,
      source: { kind: 'solid' },
      design,
      hookText: 'DO NOT DUPLICATE',
    });
    await writeBundle(coverBundle(cover, null, FONTS_DIR), dir);
    await page.setViewport(VIDEO_SIZES[aspect]);
    await page.goto(pathToFileURL(join(dir, 'index.html')).href);
    await page.evaluate('document.fonts.ready');
    return (await page.evaluate(measurements)) as {
      layers: {
        x: number;
        y: number;
        width: number;
        height: number;
        scrollHeight: number;
        clientHeight: number;
        scrollWidth: number;
        clientWidth: number;
        size: number;
        fill: string;
        font: string;
      }[];
      duplicatePreset: boolean;
      path: string;
    };
  }

  it.each(['9:16', '4:5', '16:9'] as const)(
    'preserves authored %s hierarchy, paths, color and intentional branding placement',
    async (aspect) => {
      const result = await draw(aspect);
      const size = VIDEO_SIZES[aspect];
      expect(result.duplicatePreset).toBe(false);
      expect(result.layers).toHaveLength(8);
      expect(result.layers[0]!.font).toContain('Montserrat');
      expect(result.layers[0]!.size).toBeGreaterThan(result.layers[2]!.size * 4);
      expect(result.layers[1]!.fill).toBe('rgb(237, 117, 27)');
      expect(result.path).toBe('M0.05 0.98 C0.95 0.85 0.2 0.45 0.84 0.04');
      expect(result.layers[7]!.y).toBeCloseTo(size.height * 0.922, 0);
      for (const index of [0, 2, 6, 7]) {
        const layer = result.layers[index]!;
        expect(layer.scrollHeight).toBeLessThanOrEqual(layer.clientHeight + 1);
        expect(layer.scrollWidth).toBeLessThanOrEqual(layer.clientWidth + 1);
      }
      const jpeg = await page.screenshot({
        type: 'jpeg',
        quality: 90,
        ...(aspect === '9:16' ? { path: '/tmp/taalcut-authored-cover-proof.jpg' as const } : {}),
      });
      expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      expect(jpeg.length).toBeGreaterThan(20_000);
    },
  );

  it('preserves a supplied image with contain and moves the focal crop only when cover is requested', async () => {
    const photo = join(dir, 'crop-source.png');
    await page.setViewport({ width: 200, height: 100 });
    await page.setContent(
      '<body style="margin:0;background:blue"><div style="width:100px;height:100px;background:red"></div></body>',
    );
    await page.screenshot({ type: 'png', path: photo });
    const sample = async (fit: 'contain' | 'cover', x: number) => {
      const design = airportDesign();
      design.backdrop = { fit, x, y: 0.5 };
      design.layers = [design.layers[1]!];
      const bundle = coverBundle(
        { ...coverSettingsSchema.parse({ aspect: '9:16', source: { kind: 'frame', frame: 0 } }), design },
        photo,
        FONTS_DIR,
      );
      await writeBundle(bundle, dir);
      await page.setViewport(VIDEO_SIZES['9:16']);
      await page.goto(pathToFileURL(join(dir, 'index.html')).href);
      const screenshot = await page.screenshot({ type: 'png', encoding: 'base64' });
      return (await page.evaluate(`(async () => {
        const img=new Image(); img.src='data:image/png;base64,${screenshot}'; await img.decode();
        const c=document.createElement('canvas');c.width=1080;c.height=1920;
        const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
        return [[100,100],[100,960],[1000,960]].map(([x,y])=>[...ctx.getImageData(x,y,1,1).data].slice(0,3));
      })()`)) as number[][];
    };
    expect(await sample('contain', 0.5)).toEqual([
      [233, 223, 203],
      [255, 0, 0],
      [0, 0, 255],
    ]);
    expect((await sample('cover', 0))[1]).toEqual([255, 0, 0]);
    expect((await sample('cover', 1))[1]).toEqual([0, 0, 255]);
  });

  it('fits a longer edited title inside its authored box without moving the underline or branding', async () => {
    const before = await draw('9:16');
    const after = await draw('9:16', true);
    expect(after.layers[0]!.size).toBeLessThan(before.layers[0]!.size);
    expect(after.layers[0]!.scrollHeight).toBeLessThanOrEqual(after.layers[0]!.clientHeight + 1);
    expect(after.layers[1]).toEqual(before.layers[1]);
    expect(after.layers[7]).toEqual(before.layers[7]);
  });
});
