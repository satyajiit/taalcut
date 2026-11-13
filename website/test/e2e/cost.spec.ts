// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, type Locator, type Page, test } from '@playwright/test';
import { backWords, change, changeWords, COST_CHANGES, COST_OPTIONS, COST_SECTION, costInWords, priceWords } from '../../src/content/cost';

/**
 * WEB3 lane K: what a month of videos costs, on the home after Your AI and on /ai/ after the profiles. The figures are
 * cost.ts's; every percentage on the page must be one it computes.
 */

const C = COST_SECTION;
const section = (page: Page) => page.locator(`section#${C.id}`);
const board = (page: Page) => section(page).locator('[data-slot="cost-board"]');
/** Every percentage in a block's visible text. */
const percentages = async (where: Locator) => [...(await where.innerText()).matchAll(/[−-]?\d+(?:\.\d+)?\s?%/g)].map((m) => m[0]);

for (const path of ['/', '/ai/'] as const) {
  test.describe(`what it costs, on ${path}`, () => {
    test('says the three prices, the basis and that Taalcut is free, with only computed changes', async ({ page }) => {
      await page.goto(path);
      const s = section(page);
      await s.scrollIntoViewIfNeeded();
      await expect(s.getByRole('heading', { level: 2 })).toHaveText(path === '/' ? C.heading : C.ai.heading);
      await expect(board(page)).toContainText(C.basis('month'));
      for (const o of COST_OPTIONS) {
        const row = board(page).locator(`[data-cost="${o.id}"]`);
        await expect(row).toContainText(o.name);
        await expect(row).toContainText(o.line);
        await expect(row.locator('[data-slot="cost-price"]')).toHaveText(`${priceWords(o.id, 'month')} a month`.replace(/\s+/g, ' '), { useInnerText: true });
      }
      await expect(board(page).locator('[data-cost="cloud"]')).toContainText('Taalcut is free.');
      const shown = await percentages(s);
      expect(shown.length).toBeGreaterThanOrEqual(4);
      for (const p of shown) expect(COST_CHANGES.map(change), p).toContain(p);
    });

    test('switches between a month and a year by pointer and by arrow key, the bars keeping their lengths', async ({ page }) => {
      await page.goto(path);
      const b = board(page);
      await b.scrollIntoViewIfNeeded();
      const month = b.getByRole('radio', { name: C.periods.month });
      const year = b.getByRole('radio', { name: C.periods.year });
      await expect(month).toHaveAttribute('aria-checked', 'true');
      const widths = () => b.locator('[data-slot="cost-bar"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
      const before = await widths();
      await expect(async () => {
        await year.click({ timeout: 1000 });
        await expect(year).toHaveAttribute('aria-checked', 'true', { timeout: 500 });
      }).toPass();
      await expect(b).toContainText(C.basis('year'));
      await expect(section(page)).toContainText(backWords('cloud', 'year'));
      await expect(section(page)).toContainText(backWords('local', 'year'));
      await expect(b.locator('[data-cost="editor"] [data-slot="cost-price"]')).toContainText('$60,000');
      expect(await widths()).toEqual(before);
      await year.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(month).toHaveAttribute('aria-checked', 'true');
      await expect(month).toBeFocused();
      await expect(b).toContainText(C.basis('month'));
      await expect(section(page)).toContainText(changeWords('cloud'));
    });
  });
}

test.describe('what it costs, on the home', () => {
  test('sits right after Your AI and before Private by default, on Your AI’s canvas', async ({ page }) => {
    await page.goto('/');
    const order = await page.evaluate(() => [...document.querySelectorAll('main > section[id]')].map((s) => s.id));
    expect(order.slice(order.indexOf('your-ai'), order.indexOf('your-ai') + 3)).toEqual(['your-ai', C.id, 'private']);
    const grounds = await page.evaluate((ids) => ids.map((id) => getComputedStyle(document.getElementById(id)!).backgroundColor), ['your-ai', C.id]);
    expect(grounds[0]).toBe(grounds[1]);
  });

  test('runs once on arrival, rests filled, and plays again from its button', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const b = board(page);
    await b.scrollIntoViewIfNeeded();
    const fill = b.locator('[data-cost="editor"] [data-slot="cost-segment"] > span').last();
    const scale = () => fill.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    await expect.poll(scale, { timeout: 5000 }).toBe(1);
    await b.getByRole('button', { name: C.replay }).click();
    await expect.poll(scale, { timeout: 2000 }).toBeLessThan(1);
    await expect.poll(scale, { timeout: 5000 }).toBe(1);
    // Kaatu once, by the zero; no marigold anywhere in the section.
    await expect(section(page).locator('[data-slot="kaatu"]')).toHaveCount(1);
    const marigold = await section(page).evaluate((s) =>
      [...s.querySelectorAll('*')].some((el) => /marigold/.test(el.getAttribute('class') ?? '') || el.getAttribute('data-field') === 'marigold'),
    );
    expect(marigold).toBe(false);
  });

  test('says the comparison in the FAQ’s cost answer', async ({ page }) => {
    await page.goto('/faq/#cost');
    await expect(page.getByText(costInWords(), { exact: false })).toBeVisible();
  });
});

test.describe('what it costs, on /ai/', () => {
  test('sits after the profiles and before the download band, with no Kaatu of its own', async ({ page }) => {
    await page.goto('/ai/');
    const order = await page.evaluate(() => [...document.querySelectorAll('main > section[id]')].map((s) => s.id));
    expect(order[order.indexOf('local-only') + 1]).toBe(C.id);
    await expect(section(page).locator('[data-slot="kaatu"]')).toHaveCount(0);
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('shows the finished board: every bar filled, every sticker and figure in place', async ({ page }) => {
    await page.goto('/');
    const b = board(page);
    await expect(b.locator('[data-slot="cost-saved"]')).toHaveCount(2);
    await expect(b).toContainText(backWords('local', 'month'));
    await expect(b).toContainText(changeWords('local'));
    // Kaatu's own atlas layers rest hidden by design (its sheets for other frames); everything else shows.
    const hidden = await b.evaluate((el) => [...el.querySelectorAll('*')].filter((n) => !n.closest('[data-slot="kaatu"]') && getComputedStyle(n).opacity === '0').length);
    expect(hidden).toBe(0);
  });
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows the finished state at once, with nothing to play again', async ({ page }) => {
    await page.goto('/');
    const b = board(page);
    await b.scrollIntoViewIfNeeded();
    await expect(b.getByRole('button', { name: C.replay })).toHaveCount(0);
    const scales = await b.locator('[data-slot="cost-segment"] > span').evaluateAll((els) => els.map((el) => new DOMMatrix(getComputedStyle(el).transform).a));
    expect(scales.every((s) => s === 1)).toBe(true);
    await expect(b.locator('[data-slot="sticker"]').first()).toBeVisible();
  });
});

test.describe('on a phone', () => {
  for (const width of [320, 375]) {
    test(`keeps the board inside the screen at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const b = board(page);
      await b.scrollIntoViewIfNeeded();
      await page.waitForTimeout(3500);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      const box = (await b.boundingBox())!;
      const stickers = await b.locator('[data-slot="sticker"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
      for (const right of stickers) expect(right).toBeLessThanOrEqual(box.x + box.width + 1);
    });
  }
});
