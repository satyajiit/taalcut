// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* global document, window, HTMLCanvasElement, CanvasRenderingContext2D, Image, NodeFilter */

/**
 * Captures the app's screens for the README, in the light theme at 2×, from the renderer's development server and
 * its sample data. Start the server first:
 *
 *   pnpm --filter @taalcut/renderer dev --host 127.0.0.1 --port 4186 --strictPort
 *   node design/readme/stills.mjs && node design/readme/capture.mjs
 *
 * Three things differ from what the server shows by itself, so the pictures match the shipped app and its
 * demonstration footage:
 *  - The sample library paints its thumbnails as drawings. Here each drawing is replaced by a still of the
 *    demonstration footage (MEDIA-LICENSE.md), the same still for the same drawing.
 *  - The sample data is set in Goa and the footage is from Vietnam, so "Goa" reads "Vietnam".
 *  - Rows only a development build has (Traces, UI kit, the catalogue switcher) are hidden.
 * Every image made from these captures says "Interface preview with sample media".
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(new URL('../../apps/renderer/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const here = import.meta.dirname;
const origin = process.env.TAALCUT_RENDERER ?? 'http://127.0.0.1:4186';
const out = join(here, 'build/captures');
mkdirSync(out, { recursive: true });

/** Camera-roll stills in the order thumbnails take them: no two alike side by side, none with a caption burnt in. */
const ROLL = [
  'repeat-06', 'vietnam-02', 'repeat-05', 'repeat-04', 'vietnam-09', 'repeat-13', 'repeat-08', 'vietnam-04',
  'repeat-09', 'vietnam-12', 'repeat-15', 'vietnam-13', 'repeat-01', 'vietnam-08', 'repeat-11', 'vietnam-05',
  'repeat-02', 'vietnam-11', 'repeat-03', 'vietnam-10', 'repeat-07', 'vietnam-06', 'repeat-12', 'vietnam-07',
  'repeat-10', 'vietnam-03', 'repeat-14',
]; // prettier-ignore
const stills = ROLL.map((name) => {
  const bytes = readFileSync(join(here, 'build/stills', `roll-${name}.jpg`));
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
});

const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA';
const TEMPLATE = '01K7C5M6Q85000000000000001';
const CONVERSATION = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6';
/** `after` runs once the screen has settled, before the picture is taken. */
const SHOTS = [
  { name: 'agent', path: '/chat' },
  { name: 'consent', path: `/chat/${CONVERSATION}` },
  // Down to the import's progress line, so the grid fills the picture.
  { name: 'library', path: '/library', after: (page) => scrollMain(page, 188) },
  { name: 'template', path: `/templates/${TEMPLATE}` },
  { name: 'make', path: '/projects' },
  // The editor with its detailed timeline open: slots, sound and captions under the preview.
  {
    name: 'editor',
    path: `/projects/${PROJECT}/timeline`,
    after: (page) => page.getByRole('button', { name: 'Detailed timeline' }).click(),
  },
];

/** Scrolls the page's main area and leaves the pointer where it hovers nothing. */
async function scrollMain(page, by) {
  await page.mouse.move(900, 500);
  await page.mouse.wheel(0, by);
  await page.waitForTimeout(400);
  await page.mouse.move(120, 600);
}

/** Runs in the page before the app: sample drawings become stills, wherever the app asks a canvas for a JPEG. */
function useStills(sources) {
  const images = sources.map((source) => {
    const image = new Image();
    image.src = source;
    return image;
  });
  const assigned = new Map();
  const original = HTMLCanvasElement.prototype.toDataURL;
  window.__stillsMissed = 0;

  /** A drawing's signature: its colours at six places, coarse enough to be the same at every size. */
  function signature(context, width, height) {
    const places = [[0.5, 0.03], [0.1, 0.3], [0.9, 0.3], [0.5, 0.6], [0.2, 0.9], [0.8, 0.97]]; // prettier-ignore
    return places
      .map(([x, y]) => {
        const [r, g, b] = context.getImageData(
          Math.floor(x * (width - 1)),
          Math.floor(y * (height - 1)),
          1,
          1,
        ).data;
        return `${r >> 5}${g >> 5}${b >> 5}`;
      })
      .join('-');
  }

  function cover(context, image, x, y, width, height) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const [w, h] = [width / scale, height / scale];
    // A portrait still shown landscape keeps the band a third of the way down, where the subject usually is.
    const top = (image.naturalHeight - h) * (width > height ? 0.38 : 0.5);
    context.drawImage(image, (image.naturalWidth - w) / 2, top, w, h, x, y, width, height);
  }

  function stillFor(key) {
    if (!assigned.has(key)) assigned.set(key, assigned.size % images.length);
    return images[assigned.get(key)];
  }

  HTMLCanvasElement.prototype.toDataURL = function toDataURL(type, quality) {
    if (this.isConnected || type !== 'image/jpeg') return original.call(this, type, quality);
    const context = this.getContext('2d');
    const { width, height } = this;
    if (images.some((image) => !image.complete || image.naturalWidth === 0)) {
      window.__stillsMissed += 1;
      return original.call(this, type, quality);
    }
    const ratio = width / height;
    const single = ratio < 0.7 || Math.abs(ratio - 1) < 0.05 || Math.abs(ratio - 16 / 9) < 0.1;
    if (single) {
      cover(context, stillFor(signature(context, width, height)), 0, 0, width, height);
    } else {
      // A template's sheet: 90×160 tiles, each its own drawing.
      const [tileWidth, tileHeight] = [90, 160];
      for (let y = 0; y + tileHeight <= height; y += tileHeight) {
        for (let x = 0; x + tileWidth <= width; x += tileWidth) {
          const tile = document.createElement('canvas');
          [tile.width, tile.height] = [tileWidth, tileHeight];
          const tileContext = tile.getContext('2d');
          tileContext.drawImage(this, x, y, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);
          cover(
            context,
            stillFor(signature(tileContext, tileWidth, tileHeight)),
            x,
            y,
            tileWidth,
            tileHeight,
          );
        }
      }
    }
    return original.call(this, type, 0.9);
  };

  // Words the sample preview draws on its canvas follow the same rule as the page's text (matchShippedApp).
  for (const method of ['fillText', 'strokeText']) {
    const draw = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function text(words, ...rest) {
      return draw.call(
        this,
        String(words)
          .replace(/\bGOA\b/g, 'VIETNAM')
          .replace(/\bGoa\b/g, 'Vietnam'),
        ...rest,
      );
    };
  }
}

/** Runs in the page before each picture: the footage's country in the sample text, and no development-only rows. */
function matchShippedApp() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (/goa/i.test(node.nodeValue)) {
      node.nodeValue = node.nodeValue.replace(/\bGOA\b/g, 'VIETNAM').replace(/\bGoa\b/g, 'Vietnam');
    }
  }
  const hidden = [...document.querySelectorAll('a[href="/dev/traces"], a[href="/dev/kit"]')];
  const languages = document.querySelector('svg.lucide-languages');
  if (languages) hidden.push(languages.closest('button') ?? languages);
  for (const element of hidden) element.style.display = 'none';
  return hidden.length;
}

// For trying a route before adding it above: TAALCUT_README_SHOTS='[{"name":"try","path":"/renders"}]'.
SHOTS.push(...JSON.parse(process.env.TAALCUT_README_SHOTS ?? '[]'));
const only = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    colorScheme: 'light',
  });
  await context.addInitScript(useStills, stills);
  const page = await context.newPage();
  // The stills decode before the app starts painting: its entry script waits a moment.
  await page.route('**/src/main.tsx*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });
  for (const shot of SHOTS.filter((entry) => only.length === 0 || only.includes(entry.name))) {
    await page.goto(`${origin}${shot.path}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.locator('main').first().waitFor({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    if (shot.after) {
      await shot.after(page);
      await page.waitForTimeout(700);
    }
    const hidden = await page.evaluate(matchShippedApp);
    if (hidden < 3)
      throw new Error(`${shot.name}: expected three development-only rows to hide, found ${hidden}`);
    const missed = await page.evaluate(() => window.__stillsMissed);
    if (missed > 0)
      throw new Error(`${shot.name}: ${missed} thumbnail(s) were painted before the stills were ready`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(out, `${shot.name}.png`), animations: 'disabled' });
    process.stdout.write(`${shot.name}: ${shot.path}\n`);
  }
} finally {
  await browser.close();
}
