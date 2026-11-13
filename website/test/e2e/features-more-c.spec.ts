// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';
import { feature } from '../../src/content/features';

/**
 * WEB3 lanes C, then L and P: Product launch videos (/features/launch-videos/) and A video per feature (/features/product-videos/).
 * Each page's showcase in the app window, finished in the server HTML; worked by keyboard; its fragment on the
 * features index; no sideways scroll at 320 px; and, under reduced motion, finished at once.
 */

const LAUNCH = '/features/launch-videos/';
const PRODUCT = '/features/product-videos/';
const showcase = (page: Page, slug: string) => page.locator(`[data-showcase="${slug}"]`);

/** Scroll the showcase into view and wait for its arrival to finish. */
async function settled(page: Page, slug: string) {
  const plate = showcase(page, slug);
  await plate.scrollIntoViewIfNeeded();
  await expect(plate.locator('[data-pass]')).toHaveAttribute('data-pass', 'finished', { timeout: 10_000 });
  return plate;
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('launch videos: the finished video leads in four formats, production done, the script approved', async ({ page }) => {
    await page.goto(LAUNCH);
    const plate = showcase(page, 'launch-videos');
    await expect(page.getByRole('group', { name: /^A demonstration of the Taalcut app/ }).locator('[data-showcase="launch-videos"]')).toHaveCount(1);
    await expect(plate.getByRole('tab')).toHaveCount(0);
    for (const name of ['Landscape · 16:9', 'Portrait · 9:16', 'Square · 1:1', 'Portrait · 4:5']) {
      await expect(plate.getByRole('img', { name: new RegExp(`^${name}, scene 1: `) })).toBeVisible();
    }
    await expect(plate).toContainText('Your video is ready. Open the editor to make it yours.');
    await expect(plate.locator('[data-task][data-status="completed"]')).toHaveCount(5);
    await expect(plate.getByRole('button', { name: 'Open editor' })).toBeVisible();
    await expect(plate.locator('[data-slot="approval"]')).toHaveAttribute('data-status', 'approved');
    await expect(plate).toContainText('Version 1 · approved');
    const facts = page.getByRole('region', { name: 'What it does' });
    await expect(facts.locator('[data-slot="vignette"]')).toHaveCount(feature('launch-videos').facts.length);
  });

  test('product videos: the idea reels with their quotes, why the first fits, your video, its post awaiting approval and the schedule', async ({ page }) => {
    await page.goto(PRODUCT);
    const plate = showcase(page, 'product-videos');
    await expect(page.getByRole('group', { name: /^A demonstration of the Taalcut app/ }).locator('[data-showcase="product-videos"]')).toHaveCount(1);
    await expect(plate.locator('[data-idea]')).toHaveCount(3);
    await expect(plate.locator('[data-idea] [data-frame="footage"]')).toHaveCount(3);
    await expect(plate.locator('[data-idea] [data-quote]')).toHaveCount(3);
    await expect(plate.locator('[data-idea="reel-breakdown"] [data-quote]')).toContainText('Cuts, music beats, on-screen text and its timing');
    await expect(plate.locator('[data-idea="reel-breakdown"] button')).toHaveAttribute('aria-pressed', 'true');
    await expect(plate.locator('[data-why] [data-evidence]')).toContainText(feature('reel-breakdown').definition);
    await expect(plate.locator('[data-slot="clip-reel"]')).toHaveCount(1);
    await expect(plate.getByRole('switch', { name: 'Research this product on a schedule' })).toHaveAttribute('aria-checked', 'true');
    await expect(plate.locator('[data-post="waiting"]')).toContainText('Awaiting approval');
    await expect(plate).toContainText('Publication uses your connected Postiz account after approval.');
    const facts = page.getByRole('region', { name: 'What it does' });
    await expect(facts.locator('[data-slot="vignette"]')).toHaveCount(feature('product-videos').facts.length);
  });

  test('the features index shows both fragments in their windows', async ({ page }) => {
    await page.goto('/features/');
    await expect(page.locator('[data-feature="launch-videos"] [data-showcase="launch-videos-fragment"]')).toBeVisible();
    await expect(page.locator('[data-feature="product-videos"] [data-showcase="product-videos-fragment"]')).toBeVisible();
  });
});

test.describe('by keyboard', () => {
  test('launch videos: change a scene, approve again, watch it made, turn a format off, open the editor', async ({ page }) => {
    await page.goto(LAUNCH);
    const plate = await settled(page, 'launch-videos');
    const approval = plate.locator('[data-slot="approval"]');
    const press = async (name: string) => {
      await plate.getByRole('button', { name, exact: true }).focus();
      await page.keyboard.press('Enter');
    };
    await expect(approval.getByRole('button', { name: 'Approve script & design' })).toBeDisabled();
    await press('Scene 2, half a second longer');
    await expect(plate.locator('[data-scene-row="s2"]')).toContainText('5.5 s');
    await expect(plate).toContainText('Version 2 · not approved yet');
    await expect(plate).toContainText('6 scenes · 30.5 s');
    await plate.getByRole('textbox', { name: 'Scene 1, on-screen words' }).focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Made with Taalcut');
    // Production waits for the new version's approval.
    await expect(plate).toContainText('Approve the current script and visual direction to create your video.');
    await expect(plate.locator('[data-task="designer"]')).toHaveAttribute('data-status', 'queued');
    await press('Approve script & design');
    await expect(plate.locator('[data-slot="play-control"]')).toBeFocused();
    await expect(plate.locator('[data-task="designer"]')).toHaveAttribute('data-status', 'running');
    await expect(plate.locator('[data-task="reviewer"]')).toHaveAttribute('data-status', 'completed', { timeout: 5_000 });
    await expect(plate).toContainText('Version 2 · approved');
    // Pause, then jump to a scene: every format shows its words.
    const control = plate.locator('[data-slot="play-control"]');
    if ((await control.getAttribute('aria-label')) === 'Pause the video') await control.click();
    await expect(control).toHaveAttribute('aria-label', 'Play the video');
    await press('Scene 1');
    await expect(plate.getByRole('img', { name: /scene 1: Made with Taalcut$/ })).toHaveCount(4);
    await press('Scene 3');
    await expect(plate.getByRole('img', { name: /^Portrait · 9:16, scene 3: Each slot gets the clip that fits\.$/ })).toBeVisible();
    // Turn portrait 9:16 off in the brief: its frame leaves the video.
    await plate.getByRole('checkbox', { name: 'Portrait · 9:16' }).focus();
    await page.keyboard.press('Space');
    await expect(plate.locator('[data-format]')).toHaveCount(3);
    await expect(plate.locator('[data-format="9:16"]')).toHaveCount(0);
    await press('Open editor');
    const editor = plate.getByRole('region', { name: 'The video in the editor' });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('list', { name: 'Graphics' })).toContainText('Made with Taalcut');
  });

  test('product videos: choose an idea’s reel to make it your video, approve its post, find more ideas, set the schedule', async ({ page }) => {
    await page.goto(PRODUCT);
    const plate = await settled(page, 'product-videos');
    const shorts = plate.locator('[data-idea="shorts"] button');
    await shorts.focus();
    await page.keyboard.press('Enter');
    await expect(shorts).toHaveAttribute('aria-pressed', 'true');
    await expect(plate.locator('[data-why] [data-evidence]')).toContainText(feature('shorts').definition);
    const publish = plate.getByRole('region', { name: 'Publishing' });
    await expect(publish.getByRole('img', { name: /^Your video: One long video in\. A short that ends where the story does\./ })).toBeVisible({ timeout: 5_000 });
    await expect(publish).toContainText('Awaiting approval');
    const approve = publish.getByRole('button', { name: 'Approve this post and schedule' });
    await approve.focus();
    await page.keyboard.press('Enter');
    await expect(publish.locator('[data-post]')).toHaveAttribute('data-post', 'scheduled', { timeout: 5_000 });
    await expect(publish).toContainText('Scheduled');
    // Your video plays once it is on screen, and its own control pauses it.
    const control = publish.locator('[data-slot="reel-control"]');
    await control.scrollIntoViewIfNeeded();
    await expect(control).toHaveAttribute('aria-label', 'Pause the reel');
    await control.focus();
    await page.keyboard.press('Enter');
    await expect(control).toHaveAttribute('aria-label', 'Play the reel');
    await plate.getByRole('button', { name: 'Find video ideas' }).focus();
    await page.keyboard.press('Enter');
    await expect(plate.locator('[data-idea="instagram-edits"]')).toBeVisible({ timeout: 5_000 });
    await expect(plate.locator('[data-idea="reel-breakdown"]')).toHaveCount(0);
    await expect(plate.locator('[data-idea="instagram-edits"] button')).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
    const schedule = plate.getByRole('switch', { name: 'Research this product on a schedule' });
    await schedule.focus();
    await page.keyboard.press('Space');
    await expect(schedule).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Space');
    await plate.getByRole('button', { name: 'Tue', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(plate.getByRole('button', { name: 'Tue', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the index fragments work: a format re-lays the frame, an idea shows its line', async ({ page }) => {
    await page.goto('/features/');
    const launch = page.locator('[data-showcase="launch-videos-fragment"]');
    await launch.scrollIntoViewIfNeeded();
    const control = launch.getByRole('button', { name: /^(Pause|Play) the video$/ });
    if ((await control.getAttribute('aria-label')) === 'Pause the video') await control.click();
    await launch.getByRole('button', { name: /^Scene 4: / }).click();
    await expect(launch.getByRole('img', { name: /^Portrait · 4:5, scene 4: / })).toBeVisible();
    const product = page.locator('[data-showcase="product-videos-fragment"]');
    await product.locator('[data-idea="shorts"] button').focus();
    await page.keyboard.press('Enter');
    await expect(product.locator('blockquote')).toHaveText(feature('shorts').definition);
  });
});

test.describe('at 320 px', () => {
  test.use({ viewport: { width: 320, height: 720 } });
  for (const path of [LAUNCH, PRODUCT]) {
    test(`${path} has no sideways scroll`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('launch videos: finished at once, nothing plays by itself, and Play again lands finished', async ({ page }) => {
    await page.goto(LAUNCH);
    const plate = showcase(page, 'launch-videos');
    await plate.scrollIntoViewIfNeeded();
    await expect(plate.locator('[data-pass]')).toHaveAttribute('data-pass', 'finished');
    await expect(plate.locator('[data-slot="play-control"]')).toHaveAttribute('aria-label', 'Play the video');
    await plate.getByRole('button', { name: 'Play again' }).click();
    await expect(plate.locator('[data-pass]')).toHaveAttribute('data-pass', 'finished');
    await expect(plate.locator('[data-task][data-status="completed"]')).toHaveCount(5);
    await expect(plate.locator('[data-sweep]')).toHaveCount(0);
    const hidden = await plate.locator('[data-slot="launch-stage"] *').evaluateAll((els) => els.filter((el) => Number(getComputedStyle(el).opacity) < 0.05).length);
    expect(hidden).toBe(0);
  });

  test('product videos: the reels, the lines and the post are there at once; new ideas land at once, nothing plays by itself', async ({ page }) => {
    await page.goto(PRODUCT);
    const plate = showcase(page, 'product-videos');
    await plate.scrollIntoViewIfNeeded();
    await expect(plate.locator('[data-idea]')).toHaveCount(3);
    await expect(plate.locator('[data-post="waiting"]')).toBeVisible();
    await plate.getByRole('button', { name: 'Find video ideas' }).click();
    await expect(plate.locator('[data-idea="import"]')).toBeVisible();
    await expect(plate.locator('[data-ghost]')).toHaveCount(0);
    await expect(plate.locator('[data-slot="clip-reel"][data-playing]')).toHaveCount(0);
  });
});
