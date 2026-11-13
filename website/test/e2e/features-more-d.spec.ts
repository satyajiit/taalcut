// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, type Page, test } from '@playwright/test';
import { FAQ } from '../../src/content/faq';
import { FEATURE_GROUPS, FEATURES } from '../../src/content/features';
import { MORE_WAYS } from '../../src/content/home';

/**
 * WEB3 lane D: the home's More ways to make, the features index in its two parts, and the machine-read files that
 * list the eleven features.
 */

const MORE = FEATURES.filter((f) => f.group === 'more');
const section = (page: Page) => page.locator(`section#${MORE_WAYS.id}`);

/** Walks the page down so every arrival plays, then back up. */
async function walk(page: Page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
}

/** Every JSON-LD object on a page, arrays flattened. */
async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((b) => [JSON.parse(b) as unknown].flat()) as Record<string, unknown>[];
}

test.describe('More ways to make, on the home page', () => {
  test('sits after the feature tour and before the starter formats, on the canvas between two sunken grounds', async ({ page }) => {
    await page.goto('/');
    const order = await page.evaluate(() => [...document.querySelectorAll('main > section[id]')].map((s) => s.id));
    const at = order.indexOf(MORE_WAYS.id);
    expect(order[at - 1]).toBe('features');
    expect(order[at + 1]).toBe('formats');
    const grounds = await page.evaluate(
      (ids) => ids.map((id) => getComputedStyle(document.getElementById(id)!).backgroundColor),
      ['features', MORE_WAYS.id, 'formats'],
    );
    expect(grounds[0]).toBe(grounds[2]);
    expect(grounds[1]).not.toBe(grounds[0]);
  });

  test('shows the six features, each with its drawing, its glyph and its name linking its page', async ({ page }) => {
    await page.goto('/');
    const s = section(page);
    await expect(s.getByRole('heading', { level: 2, name: MORE_WAYS.heading })).toBeVisible();
    await expect(s.locator('[data-more]')).toHaveCount(6);
    for (const f of MORE) {
      const item = s.locator(`[data-more="${f.slug}"]`);
      await item.scrollIntoViewIfNeeded();
      await expect(item.getByRole('heading', { level: 3, name: f.name })).toBeVisible();
      await expect(item.getByRole('link', { name: f.name })).toHaveAttribute('href', `/features/${f.slug}/`);
      await expect(item.locator('[data-slot="more-drawing"]')).toHaveAttribute('aria-hidden', 'true');
      await expect(item.getByText(MORE_WAYS.rows[f.slug as keyof typeof MORE_WAYS.rows].line)).toBeVisible();
    }
    await expect(s.getByRole('link', { name: MORE_WAYS.all })).toHaveAttribute('href', '/features/');
    // Kaatu once, and the brands by their own icons: Apple for the Mac's ways in, YouTube, Instagram, Claude, Codex.
    await expect(s.locator('[data-slot="kaatu"]')).toHaveCount(1);
    for (const brand of ['apple', 'youtube', 'instagram', 'claude', 'codex']) await expect(s.locator(`[data-brand="${brand}"]`).first()).toBeAttached();
  });

  test('works by keyboard: Tab reaches each feature’s link in turn, and Enter opens its page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await section(page).getByRole('link', { name: MORE_WAYS.all }).focus();
    for (const f of MORE) {
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toHaveAttribute('href', `/features/${f.slug}/`);
    }
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/features/${MORE.at(-1)!.slug}/$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(MORE.at(-1)!.name);
  });

  test('fits 320 px: every drawing inside the screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/');
    await walk(page);
    for (const box of await section(page).locator('[data-slot="more-drawing"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(320);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  });
});

test.describe('More ways to make, without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('is all there in the server HTML, every drawing finished', async ({ page }) => {
    await page.goto('/');
    const s = section(page);
    await expect(s.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(s.getByRole('heading', { level: 3 })).toHaveCount(6);
    await expect(s.getByText(MORE_WAYS.rows['instagram-edits'].cut)).toBeVisible();
    await expect(s.getByText(MORE_WAYS.rows['launch-videos'].approve)).toBeVisible();
    const hidden = await s.evaluate((root) =>
      [...root.querySelectorAll('*')]
        .filter((el) => !el.closest('[data-slot="kaatu"]') && getComputedStyle(el).opacity === '0')
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(hidden).toEqual([]);
  });
});

test.describe('More ways to make, under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows each drawing’s finished state at once', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const s = section(page);
    // Below the fold at load, yet finished: no arrival waits for it.
    expect(await s.locator('h2').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await walk(page);
    const faded = await s.evaluate((root) =>
      // Kaatu's own layers swap frames by opacity, and a mark's strokes keep their drawn opacity; everything else rests
      // fully shown.
      [...root.querySelectorAll('[data-more] *')]
        .filter((el) => !el.closest('[data-slot="kaatu"], svg') && Number(getComputedStyle(el).opacity) < 1)
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(faded).toEqual([]);
  });
});

test.describe('the features index, in two parts', () => {
  test('heads each part with its h2 and lead, then lists its features as h3 rows', async ({ page }) => {
    await page.goto('/features/');
    await expect(page.locator('[data-feature]')).toHaveCount(FEATURES.length);
    for (const g of FEATURE_GROUPS) {
      const part = page.locator(`[data-feature-group="${g.id}"]`);
      await expect(part.getByRole('heading', { level: 2, name: g.title })).toBeVisible();
      await expect(part.getByText(g.lead)).toBeVisible();
      const own = FEATURES.filter((f) => f.group === g.id);
      await expect(part.locator('[data-feature]')).toHaveCount(own.length);
      for (const f of own) await expect(part.locator(`[data-feature="${f.slug}"]`).getByRole('heading', { level: 3, name: f.name })).toBeAttached();
    }
    // One list in two parts: the second part's numbering carries on from the first.
    expect(await page.locator('[data-feature-group="more"] ol').getAttribute('start')).toBe('6');
  });

  test('takes a part’s link to its feature’s row, by keyboard', async ({ page }) => {
    await page.goto('/features/');
    const link = page.locator('[data-feature-group="more"]').getByRole('link', { name: 'Shorts from long videos', exact: true });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#shorts$/);
    await expect(page.locator('li#shorts').getByRole('heading', { level: 3 })).toBeInViewport();
  });

  test('says the eleven in its JSON-LD, as an ordered list', async ({ page }) => {
    await page.goto('/features/');
    const list = (await jsonLd(page)).find((i) => i['@type'] === 'ItemList');
    const items = list?.itemListElement as { name: string; position: number }[];
    expect(items.map((i) => i.name)).toEqual(FEATURE_GROUPS.flatMap((g) => FEATURES.filter((f) => f.group === g.id).map((f) => f.name)));
  });
});

test.describe('the machine-read files', () => {
  test('llms.txt lists the feature pages in the index’s two groups', async ({ request }) => {
    const txt = await (await request.get('/llms.txt')).text();
    for (const g of FEATURE_GROUPS) {
      const part = txt.slice(txt.indexOf(`\n## ${g.title}\n`)).split('\n## ')[1] ?? '';
      for (const f of FEATURES.filter((x) => x.group === g.id)) expect(part, f.slug).toContain(`(https://taalcut.app/features/${f.slug}.md)`);
    }
  });

  test('llms-full.txt and the index’s mirror hold every new page', async ({ request }) => {
    const full = await (await request.get('/llms-full.txt')).text();
    const index = await (await request.get('/features.md')).text();
    for (const f of MORE) {
      expect(full, f.slug).toContain(`\n## ${f.name}\n`);
      expect(index, f.slug).toContain(`### ${f.name}`);
      expect((await request.get(`/features/${f.slug}.md`)).status(), f.slug).toBe(200);
    }
  });

  test('the home’s SoftwareApplication names all eleven features', async ({ page }) => {
    await page.goto('/');
    const app = (await jsonLd(page)).find((i) => i['@type'] === 'SoftwareApplication');
    expect(app?.featureList).toEqual(FEATURES.map((f) => f.name));
  });

  test('the FAQ answers the new questions, on the page and in its FAQPage JSON-LD', async ({ page }) => {
    await page.goto('/faq/');
    const ld = (await jsonLd(page)).find((i) => i['@type'] === 'FAQPage');
    const names = (ld?.mainEntity as { name: string }[]).map((q) => q.name);
    for (const id of ['iphone', 'shorts', 'instagram-edits', 'launch-video', 'product-videos', 'posting', 'other-agents']) {
      const entry = FAQ.find((e) => e.id === id)!;
      expect(names, id).toContain(entry.question);
      await expect(page.locator(`#${id}`), id).toHaveText(entry.question);
    }
  });
});
