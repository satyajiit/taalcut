// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test } from '@playwright/test';
import { FEATURES } from '../../src/content/features';

/**
 * Every features page as a whole, in the Remix Vernacular world: the footage in every frame at its own 9:16 shape and
 * never an empty frame; nothing wider than a 320 or 390 px phone; and, under reduced motion, every reel waiting for
 * the visitor's Play and every part of the page in its finished place. (features.spec.ts holds the showcases.)
 */

const PAGES = ['/features/', ...FEATURES.map((f) => `/features/${f.slug}/`)];

test.describe('the frames', () => {
  for (const path of PAGES) {
    test(`${path}: every clip frame shows the owner’s footage at 9:16, and none is empty`, async ({
      page,
    }) => {
      await page.goto(path);
      expect(await page.locator('main [data-frame]').count()).toBeGreaterThan(0);
      const frames = page.locator('main [data-frame="footage"]');
      const images = await frames.evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundImage));
      expect(images.filter((image) => !/url\(.*\/media\/(roll|reels)\/.+\.webp/.test(image))).toEqual([]);
      await expect(page.locator('main [data-frame="empty"]')).toHaveCount(0);
      // Never a stretched picture: every frame on screen keeps the footage's 9:16 shape.
      const shapes = await frames.evaluateAll((els) =>
        els.flatMap((el) => {
          // Its laid-out size, before any tilt or pop a scene gives it.
          const { offsetWidth: w, offsetHeight: h } = el as HTMLElement;
          return w > 4 && h > 4 ? [Math.round((w / h) * 1000) / 1000] : [];
        }),
      );
      expect(shapes.filter((ratio) => Math.abs(ratio - 9 / 16) > 0.03)).toEqual([]);
    });
  }
});

for (const width of [320, 390]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 760 } });

    for (const path of PAGES) {
      test(`${path}: nothing is wider than the viewport`, async ({ page }) => {
        await page.goto(path);
        const wide = await page.evaluate(() => {
          const width = document.documentElement.clientWidth;
          const fits = (el: Element) => {
            const box = el.getBoundingClientRect();
            return box.left >= -0.5 && box.right <= width + 0.5;
          };
          /**
           * An element a fitting ancestor clips (a filmstrip in its block, a sr-only label, the breakdown's lanes in
           * their own sideways scroll) can't widen the page.
           */
          const clipped = (el: Element) => {
            for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
              const style = getComputedStyle(up);
              if ((/hidden|clip|auto|scroll/.test(style.overflowX) || style.clip !== 'auto') && fits(up))
                return true;
            }
            return false;
          };
          // The page's own parts; the waitlist band (another lane's, Kaatu bleeding left by design) is checked by reflow.
          return [...document.querySelectorAll('main *')]
            .filter((el) => !el.closest('[aria-labelledby^="band-"]'))
            .filter((el) => el.getBoundingClientRect().width > 0 && !fits(el) && !clipped(el))
            .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 60)}`);
        });
        expect(wide).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth)).toBe(
          true,
        );
      });
    }
  });
}

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const path of PAGES) {
    test(`${path}: the reels never start by themselves, and everything is in its finished place`, async ({
      page,
    }) => {
      await page.goto(path);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 0));
      const playing = await page
        .locator('main video')
        .evaluateAll((els) => els.filter((v) => !(v as HTMLVideoElement).paused).length);
      expect(playing).toBe(0);
      // No section, sticker or scene is left hidden or mid-rise.
      const hidden = await page
        .locator(
          'main [data-slot="section"], main [data-slot="section"] h2, main [data-slot="sticker"], main [data-slot="vignette"], main [data-slot="feature-header"] *:not(.tc-kaatu-layer)',
        )
        .evaluateAll((els) => els.filter((el) => Number(getComputedStyle(el).opacity) < 0.05).length);
      expect(hidden).toBe(0);
      await expect(page.locator('main [data-arrival="hidden"], main [data-rise="hidden"]')).toHaveCount(0);
    });
  }
});
