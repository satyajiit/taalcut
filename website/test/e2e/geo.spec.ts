// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test } from '@playwright/test';
import { PAGES } from '../../src/content/pages';

/** The machine-readable files, the mirrors and the social cards, as the exported site serves them. */

const FILES = [
  { path: '/llms.txt', type: /^text\/plain/, starts: '# Taalcut\n' },
  { path: '/llms-full.txt', type: /^text\/plain/, starts: '# Taalcut\n' },
  { path: '/robots.txt', type: /^text\/plain/, starts: 'User-Agent: *' },
  { path: '/sitemap.xml', type: /xml/, starts: '<?xml' },
  { path: '/manifest.webmanifest', type: /^application\/manifest\+json/, starts: '{' },
  { path: '/faq.md', type: /^text\/markdown/, starts: '# Questions\n' },
  { path: '/features/agent.md', type: /^text\/markdown/, starts: '# The editor you talk to\n' },
  { path: '/.well-known/security.txt', type: /^text\/plain/, starts: '# SPDX-License-Identifier' },
] as const;

for (const file of FILES) {
  test(`${file.path} is served with its type`, async ({ request }) => {
    const response = await request.get(file.path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(file.type);
    expect((await response.text()).startsWith(file.starts)).toBe(true);
  });
}

test('an address with no mirror is the 404', async ({ request }) => {
  expect((await request.get('/no-such-page.md')).status()).toBe(404);
});

test('/faq/#footage-leaves lands on its question', async ({ page }) => {
  await page.goto('/faq/#footage-leaves');
  const heading = page.locator('h3#footage-leaves');
  await expect(heading).toHaveText('Does my footage leave my computer?');
  await expect(heading).toBeInViewport();
  const box = await heading.boundingBox();
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect(box?.y ?? 999).toBeLessThan(260);
});

/** Width and height from a PNG's IHDR chunk. */
function pngSize(body: Buffer): [number, number] {
  expect(body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return [body.readUInt32BE(16), body.readUInt32BE(20)];
}

for (const entry of PAGES.filter((p) => !p.unlisted)) {
  test(`${entry.path} links its social card and its .md mirror`, async ({ page, request }) => {
    await page.goto(entry.path);
    const image = await page.locator('meta[property="og:image"]').first().getAttribute('content');
    expect(image).toBeTruthy();
    const card = await request.get(new URL(image!).pathname);
    expect(card.status(), image!).toBe(200);
    expect(pngSize(await card.body())).toEqual([1200, 630]);

    const mirror = page.locator('link[rel="alternate"][type="text/markdown"]');
    if ((await mirror.count()) > 0) {
      const href = await mirror.getAttribute('href');
      const md = await request.get(new URL(href!).pathname);
      expect(md.status(), href!).toBe(200);
      expect((await md.text()).startsWith(`# ${entry.title}\n`)).toBe(true);
    }
  });
}

test('the pages L4 builds link their .md mirror from the head', async ({ page }) => {
  for (const path of ['/ai/', '/download/', '/faq/', '/about/', '/press/', '/privacy/', '/terms/', '/beta-terms/']) {
    await page.goto(path);
    await expect(page.locator('link[rel="alternate"][type="text/markdown"]'), path).toHaveCount(1);
  }
});

// Fix round 1: the social card, one robots meta on the 404, and JSON-LD that offers nothing to order.

test('every page keeps the site’s social card fields', async ({ request }) => {
  for (const entry of PAGES) {
    const html = await (await request.get(entry.path)).text();
    expect(html, entry.path).toContain('<meta property="og:type" content="website"/>');
    expect(html, entry.path).toContain('<meta property="og:site_name" content="Taalcut"/>');
    expect(html, entry.path).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    expect(html.match(/<meta name="robots"/g), entry.path).toBeNull();
  }
});

test('the 404 has exactly one robots meta, and it says noindex', async ({ request }) => {
  const response = await request.get('/no-such-page/');
  expect(response.status()).toBe(404);
  const robots = (await response.text()).match(/<meta name="robots" content="[^"]*"\/>/g);
  expect(robots).toEqual(['<meta name="robots" content="noindex"/>']);
});

test('SoftwareApplication JSON-LD offers nothing to order', async ({ page }) => {
  await page.goto('/download/');
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const items = blocks.flatMap((b) => [JSON.parse(b) as unknown].flat()) as Record<string, unknown>[];
  const app = items.find((i) => i['@type'] === 'SoftwareApplication');
  expect(app).toBeDefined();
  expect(app).not.toHaveProperty('offers');
  expect(app?.isAccessibleForFree).toBe(true);
});

test('/download/ says what each platform has today, with no status badge', async ({ page }) => {
  await page.goto('/download/');
  await expect(page.getByText('Supported', { exact: true })).toHaveCount(0);
  for (const line of ['signed with a Developer ID and notarized by Apple.', 'No Ubuntu download yet, and no date for one.', 'No Windows download yet.']) {
    await expect(page.getByText(line)).toHaveCount(1);
  }
});

test('a long link in running text wraps instead of pushing the page sideways', async ({ page }) => {
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/terms/');
    const link = page.getByRole('link', { name: 'GNU Affero General Public License, version 3 or later' });
    const box = await link.boundingBox();
    expect(box && box.x + box.width, `${width}px`).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px`).toBe(width);
  }
});
