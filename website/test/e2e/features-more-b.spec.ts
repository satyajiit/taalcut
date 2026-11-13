// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';

/**
 * WEB3 lanes B, then P: Sounds trending in Edits (/features/instagram-edits/) and Plugins and other agents
 * (/features/plugins/). Each page renders its showcase in the coded app window, led by the video it works on, works
 * by keyboard and touch, is in the server's HTML without a script, never scrolls sideways at 320 px, and shows its
 * finished state under reduced motion.
 */

const EDITS = '/features/instagram-edits/';
const PLUGINS = '/features/plugins/';
const plate = (page: Page, slug: string) => page.locator(`[data-showcase="${slug}"]`);

/** Scrolls a showcase's arrival into view and waits for it to finish, so the visitor's keys aren't raced. */
async function arrive(page: Page, selector: string) {
  const box = page.locator(selector).first();
  await box.scrollIntoViewIfNeeded();
  await expect(box).toHaveAttribute('data-run', 'done', { timeout: 8_000 });
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('Edits: the connected shelf, each sound with its reel and waveform, a sound cut on its beats, the vibe scores and the stage card are in the HTML', async ({ page }) => {
    await page.goto(EDITS);
    const shelf = plate(page, 'instagram-edits');
    await expect(page.getByRole('group', { name: /^A demonstration of the Taalcut app/ }).locator('[data-showcase="instagram-edits"]')).toHaveCount(1);
    for (const words of [
      'Trending sounds & hooks',
      'Instagram Edits live',
      'Royalty-free',
      'Boarding call bounce',
      'Hook drops 3.5s',
      'Cut with AI: 9 slots, each cut on a music beat',
      'Vibe scores from Edits',
      'Stage in Instagram Edits',
    ]) {
      await expect(shelf).toContainText(words);
    }
    await expect(shelf.getByRole('tab')).toHaveCount(3);
    await expect(shelf.getByRole('tab', { name: 'Trending' })).toHaveAttribute('aria-selected', 'true');
    await expect(shelf.getByRole('searchbox')).toHaveCount(0);
    const rows = shelf.locator('[data-sound]');
    await expect(rows).toHaveCount(4);
    await expect(shelf.locator('[data-sound] [data-frame="footage"]')).toHaveCount(4);
    await expect(shelf.locator('[data-sound] [data-slot="row-wave"]')).toHaveCount(4);
    await expect(shelf.locator('[data-cut]')).toHaveCount(8);
    await expect(shelf.locator('[data-score]')).toHaveCount(4);
  });

  test('Plugins: the lead is a video at work, the agent’s ask and the Postiz post both waiting; the settings follow', async ({ page }) => {
    await page.goto(PLUGINS);
    const lead = plate(page, 'plugins');
    await expect(page.getByRole('group', { name: /^A demonstration of the Taalcut app/ }).locator('[data-showcase="plugins"]')).toHaveCount(1);
    for (const words of [
      '(an external agent) is asking',
      'Can Taalcut go ahead?',
      'Export the Vietnam cut for Reels',
      'Waiting for you',
      'Night market loop',
      'Waiting for your approval',
      'Saturday, 18:30',
    ]) {
      await expect(lead).toContainText(words);
    }
    await expect(lead.locator('[data-slot="reel-frame"]')).toHaveCount(1);
    await expect(lead.locator('[data-slot="approval"] [data-frame="footage"]')).toHaveCount(1);
    await expect(lead.locator('[data-level-step="on"]')).toHaveCount(3);
    await expect(lead.getByRole('button', { name: 'Go ahead' })).toBeVisible();
    await expect(lead.getByRole('button', { name: 'Approve and schedule' })).toBeVisible();
    const settings = plate(page, 'plugins-settings');
    await expect(settings.locator('[data-plugin]')).toHaveCount(2);
    for (const words of [
      'Postiz',
      'Instagram Edits',
      'Access for the AI',
      'Run Meta AI and audio tools',
      'Let the AI use this plugin',
      'Let agents on this Mac use Taalcut',
      'Which app?',
      'Codex',
      'Connected',
      '1 waiting for you',
    ]) {
      await expect(settings).toContainText(words);
    }
    expect(await page.locator('main').innerText()).not.toMatch(/\bMCP\b/);
  });
});

test.describe('the features index without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('lists both, each with its working fragment in the app window', async ({ page }) => {
    await page.goto('/features/');
    const edits = page.locator('[data-feature="instagram-edits"]');
    await expect(edits.locator('[data-showcase]')).toBeVisible();
    await expect(edits.locator('[data-showcase]')).toContainText('Instagram Edits live');
    await expect(edits.locator('[data-sound]')).toHaveCount(3);
    const plugins = page.locator('[data-feature="plugins"]');
    await expect(plugins.locator('[data-showcase]')).toBeVisible();
    await expect(plugins.locator('[data-plugin]')).toHaveCount(2);
    await expect(plugins.locator('[data-showcase]')).toContainText('Can Taalcut go ahead?');
  });
});

test.describe('the features index by keyboard', () => {
  test('the Edits fragment plays a sound; the plugins fragment answers the agent’s ask', async ({ page }) => {
    await page.goto('/features/');
    const edits = page.locator('[data-showcase="instagram-edits-fragment"]');
    await edits.getByRole('button', { name: 'Lantern walk', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(edits.getByRole('img', { name: /^Lantern walk: 21 seconds/ })).toBeVisible();
    const plugins = page.locator('[data-showcase="plugins-fragment"]');
    await plugins.getByRole('button', { name: 'Not now' }).focus();
    await page.keyboard.press('Enter');
    await expect(plugins.locator('[data-slot="approval"]')).toHaveAttribute('data-status', 'declined');
    await expect(plugins).toContainText('Declined. Nothing was exported.');
  });
});

test.describe('by keyboard', () => {
  test('Edits: the tabs and the licence switch the list; a sound plays along its row, is cut with AI and staged', async ({ page }) => {
    await page.goto(EDITS);
    await arrive(page, '[data-showcase="instagram-edits"] [data-run]');
    const shelf = plate(page, 'instagram-edits');
    await shelf.getByRole('tab', { name: 'Trending' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(shelf.getByRole('tab', { name: 'For You' })).toHaveAttribute('aria-selected', 'true');
    await expect(shelf.getByRole('tabpanel')).toContainText('Palm deck groove');
    await page.keyboard.press('End');
    await expect(shelf.getByRole('tabpanel').locator('[data-sound]')).toHaveCount(1);
    await expect(shelf.getByRole('tabpanel')).toContainText('Night market loop');
    await shelf.getByRole('radio', { name: 'All audio' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(shelf.getByRole('radio', { name: 'Royalty-free' })).toHaveAttribute('aria-checked', 'true');
    await expect(shelf).toContainText('No tracks in this view match your filter.');
    await shelf.getByRole('button', { name: 'Clear filters' }).focus();
    await page.keyboard.press('Enter');
    await expect(shelf.getByRole('tab', { name: 'Trending' })).toHaveAttribute('aria-selected', 'true');
    await expect(shelf.getByRole('tabpanel').locator('[data-sound]')).toHaveCount(4);
    await shelf.getByRole('button', { name: 'Lantern walk', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(shelf.getByRole('button', { name: 'Lantern walk', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(shelf.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(shelf.getByRole('heading', { name: 'Lantern walk' })).toBeVisible();
    await expect(shelf.locator('[data-sound="lantern"] [data-slot="row-wave"] .bg-playhead-strong')).toHaveCount(1);
    await expect(shelf.getByRole('button', { name: 'Stage in Instagram Edits' })).toBeDisabled();
    await shelf.getByRole('button', { name: 'Cut with AI' }).focus();
    await page.keyboard.press('Enter');
    await expect(shelf.getByRole('status').filter({ hasText: /^Cut with AI: 9 slots/ })).toBeVisible();
    await expect(shelf.locator('[data-score]')).toHaveCount(4);
    await shelf.getByRole('button', { name: 'Save audio', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(shelf.getByRole('tab', { name: /Saved/ })).toContainText('2');
    await shelf.getByRole('button', { name: 'Stage in Instagram Edits' }).focus();
    await page.keyboard.press('Enter');
    await expect(shelf).toContainText('Staged in Instagram Edits. Open the Edits app to post it.');
  });

  test('Plugins: answer the agent’s ask and approve the post; then open a plugin’s views, connect Codex and revoke Claude Code', async ({ page }) => {
    await page.goto(PLUGINS);
    await arrive(page, '[data-showcase="plugins"] [data-run]');
    const lead = plate(page, 'plugins');
    await lead.getByRole('button', { name: 'Go ahead' }).focus();
    await page.keyboard.press('Enter');
    await expect(lead.locator('[data-slot="approval"]')).toHaveAttribute('data-status', 'approved');
    await expect(lead).toContainText('Approved. Claude Code exports it now.');
    await lead.getByRole('button', { name: 'Approve and schedule' }).focus();
    await page.keyboard.press('Enter');
    await expect(lead.locator('[data-post]')).toHaveAttribute('data-post', 'scheduled');
    await expect(lead).toContainText('Postiz posts it on Saturday at 18:30, then reads how it did.');

    await arrive(page, '[data-showcase="plugins-settings"] [data-run]');
    const settings = plate(page, 'plugins-settings');
    await settings.getByRole('button', { name: /Postiz/ }).focus();
    await page.keyboard.press('Enter');
    await expect(settings.getByRole('heading', { name: /^Postiz/ })).toBeVisible();
    await settings.getByRole('tab', { name: 'Access' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(settings.getByRole('tab', { name: 'Connection' })).toHaveAttribute('aria-selected', 'true');
    await expect(settings.getByRole('tabpanel')).toContainText('Credential saved');
    await expect(settings.getByRole('tabpanel')).toContainText('Credentials are write-only.');
    await page.keyboard.press('ArrowRight');
    const upload = settings.getByRole('checkbox', { name: /Upload media/ });
    await expect(upload).not.toBeChecked();
    await upload.focus();
    await page.keyboard.press('Space');
    await expect(upload).toBeChecked();
    await settings.getByRole('tab', { name: 'Access' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(settings.getByRole('tabpanel')).toContainText('api.createPost');
    await expect(settings.getByRole('tabpanel')).toContainText('External action');
    await page.keyboard.press('ArrowRight');
    const read = settings.getByRole('button', { name: 'Read skill' }).first();
    await read.focus();
    await page.keyboard.press('Enter');
    await expect(settings.getByRole('button', { name: 'Hide skill' })).toHaveAttribute('aria-expanded', 'true');
    await expect(settings).toContainText('Schedule it or post it, once you approve.');

    await settings.getByRole('radio', { name: 'Claude Code' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(settings.getByRole('radio', { name: 'Codex' })).toHaveAttribute('aria-checked', 'true');
    await settings.getByRole('button', { name: 'Connect and copy setup' }).focus();
    await page.keyboard.press('Enter');
    await expect(settings).toContainText('Copied. Paste it into Codex’s config file, ~/.codex/config.toml.');
    await expect(settings.locator('[data-session]')).toHaveCount(2);
    await expect(settings.locator('[data-session]').first()).toHaveAttribute('data-session', 'connected', { timeout: 4_000 });
    await settings.getByRole('button', { name: 'Revoke access' }).last().focus();
    await page.keyboard.press('Enter');
    await expect(settings).toContainText('Revoked. It can’t act any more.');
    await expect(settings.locator('[data-session="revoked"]')).toHaveCount(1);
    await settings.getByRole('switch', { name: 'Let agents on this Mac use Taalcut' }).focus();
    await page.keyboard.press('Space');
    await expect(settings).toContainText('Off. No agent can reach Taalcut.');
    await expect(settings.getByRole('button', { name: 'Connect and copy setup' })).toHaveCount(0);
  });

  test('Plugins: revoking the agent before you answer takes its ask away', async ({ page }) => {
    await page.goto(PLUGINS);
    await arrive(page, '[data-showcase="plugins"] [data-run]');
    const settings = plate(page, 'plugins-settings');
    await settings.getByRole('button', { name: 'Revoke access' }).click();
    await expect(plate(page, 'plugins')).toContainText('Nothing is waiting for you from other agents.');
  });
});

test.describe('by touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('Edits: tap a sound to play it, tap it again to pause', async ({ page }) => {
    await page.goto(EDITS);
    await arrive(page, '[data-showcase="instagram-edits"] [data-run]');
    const shelf = plate(page, 'instagram-edits');
    const row = shelf.getByRole('button', { name: 'Runway hum', exact: true });
    await row.tap();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await expect(shelf.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await row.tap();
    await expect(shelf.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  });
});

for (const path of [EDITS, PLUGINS, '/features/']) {
  test.describe(`${path} at 320 px`, () => {
    test.use({ viewport: { width: 320, height: 760 } });
    test('never scrolls sideways', async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    });
  });
}

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Edits and Plugins rest in their finished state, nothing hidden', async ({ page }) => {
    for (const [path, words] of [
      [EDITS, ['Cut with AI: 9 slots', 'Stage in Instagram Edits']],
      [PLUGINS, ['Let the AI use this plugin', 'Waiting for you']],
    ] as const) {
      await page.goto(path);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      const main = page.locator('main');
      for (const w of words) await expect(main).toContainText(w);
      await expect(main.locator('[data-run="playing"]')).toHaveCount(0);
      const hidden = await page
        .locator('main [data-showcase] [data-score], main [data-slot="stage-card"], main [data-slot="approval"], main [data-slot="vignette"]')
        .evaluateAll((els) => els.filter((el) => Number(getComputedStyle(el).opacity) < 0.95).length);
      expect(hidden).toBe(0);
    }
  });
});
