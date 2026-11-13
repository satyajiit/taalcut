// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, type Locator, type Page, test } from '@playwright/test';
import { USER_WORDS } from '../../src/components/showcase/agent/run-script';
import { AI_MAP, AI_MAP_OBJECTS, AI_METER } from '../../src/content/ai-map';
import { AI_STICKERS, LOCAL_ONLY, ON_DEVICE, PROFILES } from '../../src/content/providers';

/**
 * AI1 lane M on /ai/: the map of what leaves your computer (Profiles and Local only), the memory meter (On your
 * computer) and the head's art. Every fact in the app's words, by pointer, keyboard and touch, finished without
 * JavaScript and under reduced motion.
 */

const map = (page: Page) => page.locator('[data-slot="map-stage"]');
const lane = (page: Page, id: string) => page.locator(`[data-slot="map-lane"][data-lane="${id}"]`);
const meter = (page: Page) => page.locator('[data-slot="device-meter"]');

/** Clicks until the page has hydrated and the control answers (the server HTML draws it before React owns it). */
async function press(target: Locator, check: () => Promise<void>) {
  await expect(async () => {
    await target.click({ timeout: 1000 });
    await check();
  }).toPass();
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the map shows Everyday with Local only off, finished, every fact in words', async ({ page }) => {
    await page.goto('/ai/');
    await expect(page.getByRole('radio', { name: 'Everyday' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: 'Local only' })).toHaveAttribute('aria-checked', 'false');
    const stage = map(page);
    await expect(stage).toHaveAttribute('data-run', 'shown');
    await expect(stage.locator('[data-slot="map-cloud-words"]')).toHaveText('Everyday');
    // As rendered: the cloud fact's rule stands on its own line, so read the words as a visitor sees them.
    for (const [label, value] of LOCAL_ONLY.leavesWhenOff) {
      await expect(stage, label).toContainText(label);
      await expect(stage, label).toContainText(value, { useInnerText: true });
    }
    await expect(stage).toContainText(LOCAL_ONLY.stillRuns);
    await expect(stage).toContainText(LOCAL_ONLY.staysWhenOn[0]![1]);
    await expect(stage.locator('[data-slot="map-rule"]')).toHaveText('Taalcut asks before it first sends your files to a cloud model.');
    await expect(stage.locator('[data-slot="map-profile-line"]')).toHaveText(PROFILES[1][1]);
    // Every lane crosses with its pass on the gate, and lands outside your computer: the cloud lane with the AI.
    await expect(page.locator('[data-slot="map-lane"][data-crosses="true"]')).toHaveCount(5);
    await expect(page.locator('[data-slot="map-pass"]')).toHaveCount(5);
    await expect(stage.locator('[data-slot="map-cloud"] [data-slot="map-lane"]')).toHaveAttribute('data-lane', 'cloud');
    await expect(stage.locator('[data-slot="map-outside"] [data-slot="map-lane"]')).toHaveCount(5);
    await expect(stage.locator('[data-slot="map-computer"] [data-slot="map-lane"]')).toHaveCount(0);
    // The objects are the things themselves: the agent page's own message, the owner's footage, ElevenLabs by name.
    await expect(stage).toContainText(USER_WORDS);
    for (const words of Object.values(AI_MAP_OBJECTS)) await expect(stage).toContainText(words);
  });

  test('the meter shows a 16 GB Mac, filled, with the model in display type', async ({ page }) => {
    await page.goto('/ai/');
    await expect(page.getByRole('radio', { name: '16 GB Mac' })).toHaveAttribute('aria-checked', 'true');
    await expect(meter(page).locator('[data-slot="memory-meter"]')).toHaveAttribute('data-filled', '4');
    await expect(meter(page).locator('[data-slot="device-model"]')).toHaveText(/^Qwen3\.5 4B\s*through llama\.cpp$/);
    for (const [, value] of [ON_DEVICE.facts[0]!, ON_DEVICE.facts[1]!, ON_DEVICE.facts[2]!]) await expect(meter(page)).toContainText(value);
  });

  test('the head’s reel carries the three ways in as stickers', async ({ page }) => {
    await page.goto('/ai/');
    const art = page.locator('[data-slot="ai-head-art"]');
    await expect(art.locator('video')).toHaveCount(1);
    for (const words of Object.values(AI_STICKERS)) await expect(art.getByText(words)).toBeVisible();
  });
});

test.describe('the profiles and Local only', () => {
  test('On this Mac by pointer keeps the cloud lane home, drops speech and brings the AI here', async ({ page }) => {
    await page.goto('/ai/');
    await map(page).scrollIntoViewIfNeeded();
    const local = page.getByRole('radio', { name: 'On this Mac' });
    await press(local, () => expect(local).toHaveAttribute('aria-checked', 'true', { timeout: 500 }));
    await expect(page.locator('[data-slot="map-local-ai"]')).toContainText(PROFILES[3][1]);
    await expect(map(page).locator('[data-slot="map-cloud-words"]')).toHaveText(LOCAL_ONLY.cloudWithLocalProfile);
    await expect(lane(page, 'cloud')).toHaveAttribute('data-crosses', 'false');
    // The AI's mark and the cloud lane's card come home to your computer.
    await expect(map(page).locator('[data-slot="map-computer"] [data-slot="map-ai-mark"]')).toHaveCount(1);
    await expect(map(page).locator('[data-slot="map-computer"] [data-lane="cloud"]')).toHaveAttribute('data-place', 'local');
    await expect(lane(page, 'speech')).toHaveCount(0);
    await expect(page.locator('[data-slot="map-local-ai"]')).toContainText('Lower quality, and no AI voice or images.');
    await page.getByRole('radio', { name: 'Best quality' }).click();
    await expect(map(page).locator('[data-slot="map-cloud-words"]')).toHaveText('Best quality');
    await expect(lane(page, 'speech')).toHaveAttribute('data-crosses', 'true');
    await expect(page.locator('[data-slot="map-local-ai"]')).toHaveCount(0);
  });

  test('Local only by keyboard walls the border: only the update check crosses, and what stays is said', async ({ page }) => {
    await page.goto('/ai/');
    const sw = page.getByRole('switch', { name: 'Local only' });
    await sw.scrollIntoViewIfNeeded();
    await expect(async () => {
      await sw.focus();
      await page.keyboard.press('Space');
      await expect(sw).toHaveAttribute('aria-checked', 'true', { timeout: 500 });
    }).toPass();
    await expect(map(page)).toHaveAttribute('data-local-only', 'true');
    await expect(page.getByText(LOCAL_ONLY.whenOn)).toBeVisible();
    for (const [label, value] of LOCAL_ONLY.staysWhenOn) {
      await expect(map(page).getByText(label, { exact: false }).first()).toBeVisible();
      await expect(map(page).getByText(value, { exact: false }).first()).toBeVisible();
    }
    const crossing = page.locator('[data-slot="map-lane"][data-crosses="true"]');
    await expect(crossing).toHaveCount(1);
    await expect(crossing).toHaveAttribute('data-lane', 'updates');
    await expect(page.locator('[data-slot="map-wall"]').first()).toBeVisible();
    // Everything else is held at the wall, on your computer, the facts that stay said under it.
    await expect(map(page).locator('[data-slot="map-computer"] [data-slot="map-lane"]')).toHaveCount(4);
    await expect(map(page).locator('[data-slot="map-held"]')).toContainText(LOCAL_ONLY.staysWhenOn[1]![1]);
    await expect(map(page).locator('[data-slot="map-held"]')).toContainText(LOCAL_ONLY.staysWhenOn[2]![1]);
    await page.keyboard.press('Enter');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-slot="map-lane"][data-crosses="true"]')).toHaveCount(5);
  });

  test('the profile picker moves by arrow keys, Home and End, one tab stop', async ({ page }) => {
    await page.goto('/ai/');
    const everyday = page.getByRole('radio', { name: 'Everyday' });
    await everyday.scrollIntoViewIfNeeded();
    const best = page.getByRole('radio', { name: 'Best quality' });
    await expect(async () => {
      await everyday.focus();
      await page.keyboard.press('ArrowRight');
      await expect(best).toHaveAttribute('aria-checked', 'true', { timeout: 500 });
    }).toPass();
    await expect(best).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('radio', { name: 'On this Mac' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Fast and cheap' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-slot="map-profiles"] [role="radio"][tabindex="0"]')).toHaveCount(1);
  });

  test('the map plays on screen, pauses on request and plays its arrival again', async ({ page }) => {
    await page.goto('/ai/');
    await map(page).scrollIntoViewIfNeeded();
    // The arrival runs, then the trips start: well within five seconds.
    await expect(map(page)).toHaveAttribute('data-playing', 'true', { timeout: 5000 });
    await page.getByRole('button', { name: AI_MAP.pause }).click();
    await expect(map(page)).toHaveAttribute('data-playing', 'false');
    await page.getByRole('button', { name: AI_MAP.play }).click();
    await expect(page.getByRole('button', { name: AI_MAP.pause })).toBeVisible();
    await expect(map(page)).toHaveAttribute('data-playing', 'true', { timeout: 5000 });
  });
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('a tap picks a profile, flips Local only and picks a computer', async ({ page }) => {
    await page.goto('/ai/');
    const fast = page.getByRole('radio', { name: 'Fast and cheap' });
    await fast.scrollIntoViewIfNeeded();
    await expect(async () => {
      await fast.tap({ timeout: 1000 });
      await expect(fast).toHaveAttribute('aria-checked', 'true', { timeout: 500 });
    }).toPass();
    const sw = page.getByRole('switch', { name: 'Local only' });
    await sw.tap();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    const ubuntu = page.getByRole('radio', { name: 'Ubuntu' });
    await ubuntu.scrollIntoViewIfNeeded();
    await ubuntu.tap();
    await expect(ubuntu).toHaveAttribute('aria-checked', 'true');
    await expect(meter(page)).toContainText(ON_DEVICE.facts[3]![1]);
  });
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the map and the meter rest finished, with no play control and no trips', async ({ page }) => {
    await page.goto('/ai/');
    await map(page).scrollIntoViewIfNeeded();
    await expect(map(page)).toHaveAttribute('data-run', 'shown');
    await expect(page.getByRole('button', { name: AI_MAP.pause })).toHaveCount(0);
    await page.waitForTimeout(600);
    await expect(map(page)).toHaveAttribute('data-playing', 'false');
    await meter(page).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: AI_METER.replay })).toHaveCount(0);
    const lit = await meter(page).locator('[data-slot="job-lit"]').evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
    expect(lit.length).toBe(4);
    for (const o of lit) expect(Number(o)).toBe(1);
  });
});

test.describe('the memory meter', () => {
  test('picks a computer by pointer and arrow key, and says what runs there', async ({ page }) => {
    await page.goto('/ai/');
    const sixteen = page.getByRole('radio', { name: '16 GB Mac' });
    await sixteen.scrollIntoViewIfNeeded();
    const big = page.getByRole('radio', { name: '32 GB Mac' });
    await expect(async () => {
      await sixteen.focus();
      await page.keyboard.press('ArrowRight');
      await expect(big).toHaveAttribute('aria-checked', 'true', { timeout: 500 });
    }).toPass();
    await expect(meter(page).locator('[data-slot="device-model"]')).toHaveText(/^Qwen3\.5 9B\s*on MLX$/);
    await expect(meter(page).locator('[data-slot="memory-meter"]')).toHaveAttribute('data-filled', '8');
    await expect(meter(page)).toContainText(ON_DEVICE.facts[4]![1]);
    await page.getByRole('radio', { name: '8 GB Mac' }).click();
    await expect(meter(page).locator('[data-slot="device-model"]')).toHaveText('A small text model');
    await expect(meter(page)).toContainText(ON_DEVICE.facts[5]![1]);
    await expect(meter(page).locator('[data-slot="device-images"]')).toHaveText(AI_METER.images);
    await page.getByRole('radio', { name: 'Ubuntu' }).click();
    await expect(meter(page)).toContainText(ON_DEVICE.facts[2]![1]);
    await expect(meter(page)).toContainText(ON_DEVICE.facts[3]![1]);
    // Fill the meter again runs the arrival once more and ends filled.
    await page.getByRole('button', { name: AI_METER.replay }).click();
    await expect(meter(page).locator('[data-slot="memory-meter"]')).toHaveAttribute('data-filled', '4');
  });
});

test.describe('the map’s three zones', () => {
  test('sit side by side at 1440 px, the gate between, in about 1.4 screens with the rail', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/ai/');
    const [computer, gate, outside] = await zones(page);
    expect(computer.x + computer.width).toBeLessThanOrEqual(gate.x + 1);
    expect(gate.x + gate.width).toBeLessThanOrEqual(outside.x + 1);
    expect(Math.abs(computer.y - outside.y)).toBeLessThanOrEqual(1);
    const section = await page.locator('#local-only').boundingBox();
    expect(section!.height).toBeLessThanOrEqual(900 * 1.4);
  });

  test('stack at 390 px, your computer over the gate over outside it, with nothing sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ai/');
    const [computer, gate, outside] = await zones(page);
    expect(computer.y + computer.height).toBeLessThanOrEqual(gate.y + 1);
    expect(gate.y + gate.height).toBeLessThanOrEqual(outside.y + 1);
    for (const box of [computer, gate, outside]) expect(box.width).toBeGreaterThan(340);
  });
});

type Box = { x: number; y: number; width: number; height: number };

/**
 * Your computer, the gate and outside your computer, as laid out: measured together in one frame, so nothing that moves
 * the page between three separate measurements (a scroll, a late layout) can set one zone against another's old place.
 */
async function zones(page: Page): Promise<readonly [Box, Box, Box]> {
  await page.locator('[data-slot="map-outside"]').waitFor();
  return page.evaluate(() => {
    const box = (slot: string): Box => {
      const r = document.querySelector(`[data-slot="${slot}"]`)!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return [box('map-computer'), box('map-gate'), box('map-outside')] as const;
  });
}

test.describe('at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the head’s art stays short and nothing on the page scrolls sideways', async ({ page }) => {
    await page.goto('/ai/');
    const box = await page.locator('[data-slot="ai-head-art"]').boundingBox();
    expect(box!.height).toBeLessThanOrEqual(366);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // No visible text under 11 px in lane M's sections.
    const small = await page
      .locator('[data-slot="ai-head-art"], #on-device, #local-only')
      .evaluateAll((roots) =>
        roots.flatMap((root) =>
          [...root.querySelectorAll('*')]
            .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim()) && el.getClientRects().length > 0)
            .filter((el) => el.closest('[aria-hidden="true"]') === null || el.closest('[data-slot="sticker"]') !== null)
            .map((el) => ({ text: (el.textContent ?? '').trim().slice(0, 30), size: parseFloat(getComputedStyle(el).fontSize) }))
            .filter((t) => t.size < 11),
        ),
      );
    expect(small).toEqual([]);
  });
});
