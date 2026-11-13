// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* global document */

/**
 * Renders slides.html into the README's stills: every `data-slide` section becomes .github/media/<name>.webp at 2×.
 * Run stills.mjs and capture.mjs first; cwebp must be on the PATH.
 *
 *   node design/readme/render.mjs [name ...]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../apps/renderer/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const here = import.meta.dirname;
const scratch = join(here, 'build/slides');
const media = join(here, '../../.github/media');
mkdirSync(scratch, { recursive: true });
mkdirSync(media, { recursive: true });
const only = process.argv.slice(2);

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(join(here, 'slides.html')).href);
  // The desk colour behind the sections is for reading slides.html in a browser; the images are cut without it.
  await page.addStyleTag({ content: 'body { background: transparent !important; }' });
  await page.evaluate(() => document.fonts.ready);
  const broken = await page.evaluate(() => {
    const images = [...document.querySelectorAll('img')].filter(
      (img) => !img.complete || img.naturalWidth === 0,
    );
    return images.map((img) => img.getAttribute('src'));
  });
  if (broken.length)
    throw new Error(`Missing images: ${broken.join(', ')}. Run stills.mjs and capture.mjs first.`);
  for (const element of await page.locator('[data-slide]').all()) {
    const name = await element.getAttribute('data-slide');
    if (only.length && !only.includes(name)) continue;
    const png = join(scratch, `${name}.png`);
    // The section's rounded corners stay transparent, so the image sits on GitHub's light and dark pages alike.
    await element.screenshot({ path: png, animations: 'disabled', omitBackground: true });
    const webp = join(media, `${name}.webp`);
    execFileSync('cwebp', [
      '-quiet',
      '-q',
      '90',
      '-alpha_q',
      '100',
      '-m',
      '6',
      '-sharp_yuv',
      png,
      '-o',
      webp,
    ]);
    process.stdout.write(`${name}.webp ${(statSync(webp).size / 1024).toFixed(0)} KB\n`);
  }
} finally {
  await browser.close();
}
