// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_REEL_ID, SAMPLE_REELS } from '../../src/content/reels';
import { appWindow, approve, reel, stage, toggle, untilReady } from './hero-shared';

/**
 * The home page's signature interaction (lane L1, WEB2): the bar's flight, a clip into every slot and the list stepping
 * through them, Approve, Your version and the toggle, the visitor's Pause, the keyboard, the live region, Kaatu's dance,
 * reduced motion, the page without JavaScript, `?reel=`, and the pass on a phone at 390 and 320. The first viewport's
 * layout is hero-fold.spec.ts's. The footage is the real reel and the roll's loops, served locally by the test server.
 */
test.describe('the signature interaction', () => {
  test('the window steps through all 13 slots as the picks land, and comes back to slot 1', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const list = appWindow(page).locator('[data-slot="slot-list"]');
    await expect.poll(() => list.evaluate((el) => el.scrollTop), { timeout: 12_000 }).toBeGreaterThan(0);
    await expect.poll(() => list.evaluate((el) => Math.round(el.scrollTop + el.clientHeight) >= el.scrollHeight - 2), { timeout: 15_000 }).toBe(true);
    await untilReady(page);
    await expect.poll(() => list.evaluate((el) => el.scrollTop), { timeout: 4_000 }).toBe(0);
  });

  test('the bar flies into the window, a clip flies into every slot, the meters fill and Approve opens', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-ghost="bar"]')).toBeAttached({ timeout: 6_000 });
    await expect(page.locator('[data-ghost="clip"]').first()).toBeAttached({ timeout: 6_000 });
    await expect(approve(page)).toHaveAttribute('aria-disabled', 'true');
    await untilReady(page);
    await expect(page.locator('[data-ghost]')).toHaveCount(0);
    const rows = appWindow(page).locator('[data-slot-row]');
    await expect(rows).toHaveCount(reel.slots.length);
    await expect(appWindow(page).locator('[data-slot-row][data-filled]')).toHaveCount(reel.slots.length);
    await expect(rows.first().getByText('AI pick')).toBeVisible();
    await expect(rows.first().locator('[data-confidence="high"]')).toContainText('High');
    await expect(appWindow(page).locator('[data-slot="template-bar"]')).toBeVisible();
    await expect(approve(page)).not.toHaveAttribute('aria-disabled', 'true');
    for (const sticker of ['22 music beats', '13 slots', 'Your version']) {
      await expect(page.locator('[data-slot="hero-reel"] [data-sticker]').filter({ hasText: sticker })).toBeVisible();
    }
  });

  test('Approve turns the reel to Your version under the same bar, and the toggle switches back and forth', async ({ page }) => {
    await page.goto('/');
    await untilReady(page);
    await expect(toggle(page, 'Your version')).toHaveAttribute('aria-disabled', 'true');
    await approve(page).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'approved');
    await expect(stage(page)).toHaveAttribute('data-view', 'yours');
    await expect(approve(page)).toHaveText('Approved');
    await expect(toggle(page, 'Your version')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-slot="hero-reel"] video[aria-label]')).toHaveAttribute('aria-label', /^Your version of /);
    await expect(page.locator('[data-slot="version-layer"]')).toHaveAttribute('data-shown', 'true');
    await expect(page.locator('[data-slot="hero-reel"] [data-slot="template-bar"] [data-slot="segment"]')).toHaveCount(reel.slots.length);
    await toggle(page, 'Saved reel').click();
    await expect(stage(page)).toHaveAttribute('data-view', 'saved');
    await expect(page.locator('[data-slot="version-layer"]')).not.toHaveAttribute('data-shown', 'true');
    await toggle(page, 'Your version').click();
    await expect(stage(page)).toHaveAttribute('data-view', 'yours');
  });

  test('Use template takes the template again: the window empties and refills', async ({ page }) => {
    await page.goto('/');
    await untilReady(page);
    await page.getByRole('button', { name: 'Use template' }).click();
    await expect(stage(page)).not.toHaveAttribute('data-phase', 'ready');
    await expect(page.locator('[data-ghost="bar"]')).toBeAttached({ timeout: 4_000 });
    await untilReady(page);
    await expect(appWindow(page).locator('[data-slot-row][data-filled]')).toHaveCount(reel.slots.length);
  });

  test('the live region says each step once, never once a beat', async ({ page }) => {
    await page.addInitScript(() => {
      const said: string[] = [];
      (window as unknown as { said: string[] }).said = said;
      new MutationObserver(() => {
        const text = document.querySelector('[data-slot="pass-live"]')?.textContent ?? '';
        if (text && said.at(-1) !== text) said.push(text);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await page.goto('/');
    await untilReady(page);
    const said = await page.evaluate(() => (window as unknown as { said: string[] }).said);
    expect(said).toEqual([
      'Template taken: 13 slots.',
      '22 music beats found. Searching 1,284 clips in your camera roll.',
      'Picking a clip for each slot.',
      'Every slot has a clip. Approve is ready.',
    ]);
    await expect(page.locator('[data-slot="pass-live"]')).toHaveAttribute('aria-live', 'polite');
  });

  test('the reel’s Pause holds the pass and the footage; Play carries on', async ({ page }) => {
    await page.goto('/');
    const control = page.locator('[data-slot="hero-reel"] [data-slot="reel-control"]');
    await expect(control).toHaveAttribute('aria-label', 'Pause the reel', { timeout: 3_000 });
    await control.click();
    await expect(control).toHaveAttribute('aria-label', 'Play the reel');
    await expect(stage(page)).toHaveAttribute('data-playing', 'false');
    const held = { phase: await stage(page).getAttribute('data-phase'), filled: await appWindow(page).locator('[data-slot-row][data-filled]').count() };
    await page.waitForTimeout(2_000);
    expect({ phase: await stage(page).getAttribute('data-phase'), filled: await appWindow(page).locator('[data-slot-row][data-filled]').count() }).toEqual(held);
    expect(held.phase).not.toBe('ready');
    await control.click();
    await expect(stage(page)).toHaveAttribute('data-playing', 'true');
    await untilReady(page);
  });

  test('works by keyboard: Use template, Approve and the toggle', async ({ page }) => {
    await page.goto('/');
    await untilReady(page);
    await page.getByRole('button', { name: 'Use template' }).focus();
    await page.keyboard.press('Enter');
    await expect(stage(page)).not.toHaveAttribute('data-phase', 'ready');
    await untilReady(page);
    await approve(page).focus();
    await expect(approve(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(stage(page)).toHaveAttribute('data-view', 'yours');
    await expect(approve(page)).toBeFocused();
    await toggle(page, 'Saved reel').focus();
    await page.keyboard.press('Space');
    await expect(stage(page)).toHaveAttribute('data-view', 'saved');
    await page.keyboard.press('Tab');
    await expect(toggle(page, 'Your version')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(stage(page)).toHaveAttribute('data-view', 'yours');
    // Every control the hero adds is at least 24 px each way (WCAG 2.5.8).
    for (const control of [page.getByRole('button', { name: 'Use template' }), approve(page), toggle(page, 'Saved reel'), toggle(page, 'Your version')]) {
      const box = (await control.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
    }
  });
});

/** Counts the music notes Kaatu floats up, one a beat (kaatu-view.ts animates a .tc-kaatu-note per beat). */
async function countNotes(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { notes: number };
    w.notes = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      if (this.closest('[data-slot="hero-reel"]') && this.classList.contains('tc-kaatu-note')) w.notes += 1;
      return animate.apply(this, args);
    };
  });
  return () => page.evaluate(() => (window as unknown as { notes: number }).notes);
}

test.describe('Kaatu and the reel', () => {
  test('Kaatu dances to the reel’s music beats while it plays, and holds still once it is paused', async ({ page }) => {
    const notes = await countNotes(page);
    await page.goto('/');
    const control = page.locator('[data-slot="hero-reel"] [data-slot="reel-control"]');
    await expect(control).toHaveAttribute('aria-label', 'Pause the reel', { timeout: 3_000 });
    await expect.poll(notes, { timeout: 8_000 }).toBeGreaterThan(1);
    await control.click();
    await expect(control).toHaveAttribute('aria-label', 'Play the reel');
    await page.waitForTimeout(300);
    const held = await notes();
    await page.waitForTimeout(1_500);
    expect(await notes()).toBe(held);
    // Approve: Kaatu cheers.
    await control.click();
    await untilReady(page);
    await approve(page).click();
    await expect(page.locator('[data-slot="hero-reel"] [data-slot="kaatu"]')).toHaveAttribute('data-pose', 'cheer');
  });
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Kaatu never dances, even once the visitor plays the reel', async ({ page }) => {
    const notes = await countNotes(page);
    await page.goto('/');
    const control = page.locator('[data-slot="hero-reel"] [data-slot="reel-control"]');
    await expect(control).toHaveAttribute('aria-label', 'Play the reel');
    await control.click();
    await expect(control).toHaveAttribute('aria-label', 'Pause the reel', { timeout: 3_000 });
    await page.waitForTimeout(2_500);
    expect(await notes()).toBe(0);
  });

  test('the finished pass at once: every slot filled, nothing flies, the footage waits for Play', async ({ page }) => {
    await page.goto('/');
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready', { timeout: 2_000 });
    await expect(appWindow(page).locator('[data-slot-row][data-filled]')).toHaveCount(reel.slots.length);
    await expect(page.locator('[data-ghost]')).toHaveCount(0);
    await expect(page.locator('[data-slot="hero-reel"] [data-slot="reel-control"]')).toHaveAttribute('aria-label', 'Play the reel');
    await expect(page.locator('[data-slot="hero-reel"] [data-sticker]')).toHaveCount(3);
    await approve(page).click();
    await expect(stage(page)).toHaveAttribute('data-view', 'yours');
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the h1, the form, the platform row, the reel under its bar and the window’s words are there', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Every reel you save becomes one you can make.');
    await expect(page.locator('main input[type="email"]').first()).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Join the waitlist' }).first()).toBeVisible();
    await expect(page.locator('section[data-hero]').getByRole('list', { name: 'Platforms' })).toContainText('Windows after 1.0');
    const onReel = page.locator('[data-slot="hero-reel"]');
    await expect(onReel.locator('video')).toHaveAttribute('poster', reel.poster);
    await expect(onReel.locator('[data-part]')).toHaveText(['Hook', 'Build', 'Peak', 'Build', 'Outro']);
    // The stickers wait in a <noscript> (Playwright's no-JS mode still parses it as text, so read the served HTML).
    const html = await (await page.request.get('/')).text();
    const still = html.match(/<noscript>(.*?)<\/noscript>/gs)?.join('') ?? '';
    for (const sticker of ['22 music beats', '13 slots', 'Your version']) expect(still).toContain(sticker);
    // Nothing waits hidden for JavaScript: whatever isn't shown yet isn't in the server HTML at all.
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
    for (const text of ['Remix a reel', 'Use template on a saved reel and its slots land here.', 'Camera roll', '1,284 clips', 'Approve', 'Waiting for a template']) {
      await expect(appWindow(page).getByText(text, { exact: true })).toBeVisible();
    }
  });
});

test.describe('the reel’s address', () => {
  test('an address that names no reel keeps the default one', async ({ page }) => {
    await page.goto('/?reel=nope');
    await expect(appWindow(page)).toHaveAttribute('aria-label', `A demonstration of the Taalcut app: ${reel.project ?? reel.title}`);
    await untilReady(page);
  });

  test('the carousel shows only when there is more than one saved reel', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-slot="reel-carousel"]')).toHaveCount(SAMPLE_REELS.length > 1 ? 1 : 0);
  });

});

test.describe('with more than one saved reel', () => {
  test.skip(SAMPLE_REELS.length < 2, 'needs two reels or more');

  test('shows every saved reel on the shelf, and no empty place once there are three', async ({ page }) => {
    await page.goto('/');
    const shelf = page.locator('[data-slot="reel-carousel"]');
    await expect(shelf.locator('button[data-reel]')).toHaveCount(SAMPLE_REELS.length);
    for (const r of SAMPLE_REELS) await expect(shelf.locator(`button[data-reel="${r.id}"]`)).toHaveAccessibleName(`${r.label}: ${r.title}`);
  });

  for (const other of SAMPLE_REELS.filter((r) => r.id !== DEFAULT_REEL_ID)) {
    test(`opens the cut a link names (${other.id}), and choosing another reel writes its address and re-cuts`, async ({ page }) => {
      await page.goto(`/?reel=${other.id}`);
      await expect(page.locator(`button[data-reel="${other.id}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(appWindow(page)).toHaveAttribute('aria-label', `A demonstration of the Taalcut app: ${other.project ?? other.title}`);
      await page.locator(`button[data-reel="${DEFAULT_REEL_ID}"]`).click();
      await expect(page).toHaveURL(new RegExp(`\\?reel=${DEFAULT_REEL_ID}$`));
      await untilReady(page);
    });
  }
});

for (const width of [390, 320]) {
  test.describe(`on a phone, ${width} px wide`, () => {
    test.use({ viewport: { width, height: 844 } });

    test('the signature interaction still plays once the stage is on screen', async ({ page }) => {
      await page.goto('/');
      await stage(page).scrollIntoViewIfNeeded();
      await untilReady(page);
      await expect(appWindow(page).locator('[data-slot-row][data-filled]')).toHaveCount(reel.slots.length);
      await approve(page).click();
      await expect(stage(page)).toHaveAttribute('data-view', 'yours');
    });
  });
}
