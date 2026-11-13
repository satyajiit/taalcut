// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { coverSettingsSchema, THUMBNAIL_ARCHETYPES, VIDEO_SIZES, type ThumbnailAspect } from '@taalcut/core';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coverBundle } from '../../src/cover/cover-bundle';
import { FONTS_DIR } from '../support/fonts';
import { findTestShell } from '../support/shell';

const shell = findTestShell('cover-layout');
type Box = { x: number; y: number; right: number; bottom: number };
const boxesScript = `(() => {
  const rect = e => {
    const r = e.getBoundingClientRect();
    return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};
  };
  return {safe:rect(document.querySelector('.safe')),
    content:[...document.querySelectorAll('.hook,.kicker,.channel,.stat,.callout')].map(rect),
    words:rect(document.querySelector('.words'))};
})()`;

describe.skipIf(!shell.path)('cover design crop safety in the pinned browser', () => {
  let browser: Browser;
  let page: Page;
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-cover-layout-'));
    await symlink(FONTS_DIR, join(dir, 'fonts'));
    browser = await puppeteer.launch({ executablePath: shell.path!, headless: true });
    page = await browser.newPage();
  });
  afterAll(async () => {
    await browser?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it.each(Object.keys(VIDEO_SIZES) as ThumbnailAspect[])(
    'keeps long cover words, labels and branding inside the %s safe crop in every layout',
    async (aspect) => {
      const size = VIDEO_SIZES[aspect];
      await page.setViewport(size);
      const distinct = new Set<string>();
      for (const archetype of THUMBNAIL_ARCHETYPES) {
        for (const textAlign of ['top-left', 'left', 'bottom-left'] as const) {
          const cover = coverSettingsSchema.parse({
            aspect,
            archetype,
            textAlign,
            source: { kind: 'frame', frame: 0 },
            hookText: 'W'.repeat(48),
            kickerText: 'A LONG AIRPORT DEPARTURE',
            statBadge: 'A TWELVE SECOND CUT',
            channel: {
              name: 'Airport stories from a traveller with a long channel name',
              handle: '@somewhereabovethecity',
              show: true,
            },
          });
          const bundle = coverBundle(cover, '/original.jpg', FONTS_DIR);
          await writeFile(join(dir, 'cover.css'), bundle.files['cover.css']!);
          await writeFile(join(dir, 'index.html'), bundle.files['index.html']!);
          await page.goto(pathToFileURL(join(dir, 'index.html')).href);
          await page.evaluate('document.fonts.ready');
          const geometry = (await page.evaluate(boxesScript)) as { safe: Box; content: Box[]; words: Box };
          for (const box of geometry.content) {
            const label = `${aspect} ${archetype} ${textAlign}`;
            expect(box.x, label).toBeGreaterThanOrEqual(geometry.safe.x - 1);
            expect(box.right, label).toBeLessThanOrEqual(geometry.safe.right + 1);
            expect(box.y, label).toBeGreaterThanOrEqual(geometry.safe.y - 1);
            expect(box.bottom, label).toBeLessThanOrEqual(geometry.safe.bottom + 1);
          }
          if (textAlign === 'bottom-left') distinct.add(JSON.stringify(geometry.words));
          if (aspect === '9:16') {
            expect(geometry.safe.y).toBe(480);
            expect(geometry.safe.bottom).toBe(1440);
          }
        }
      }
      expect(distinct.size).toBe(5);
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 90 });
      expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      expect(jpeg.length).toBeGreaterThan(10_000);
    },
  );
});
