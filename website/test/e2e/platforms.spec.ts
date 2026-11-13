// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';

/**
 * /download/ ("Platforms"): each platform as Taalcut running on it, the visitor's first. The server HTML lists the
 * three in the default order; the script reads the browser's platform and moves that one to the top with its
 * "You're on…" sticker. Also: the lane's pages at 390 and 320 px without sideways scroll.
 */

const blocks = (page: Page) => page.locator('main section[data-platform]');
const order = (page: Page) =>
  blocks(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-platform')));

/** Pretends to be a browser on `platform`: its client hint and its user agent. */
async function as(page: Page, platform: string, userAgent: string) {
  await page.addInitScript(
    ([p, ua]) => {
      Object.defineProperty(Navigator.prototype, 'userAgentData', {
        get: () => ({ platform: p }),
        configurable: true,
      });
      Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => ua, configurable: true });
    },
    [platform, userAgent],
  );
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('lists the three in the default order, each with its join link and what it will get', async ({
    page,
  }) => {
    await page.goto('/download/');
    expect(await order(page)).toEqual(['macos', 'ubuntu', 'windows']);
    await expect(page.getByRole('heading', { level: 2, name: 'Apple silicon Macs' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Ubuntu 24.04' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Windows' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Join for macOS' })).toHaveAttribute(
      'href',
      '/waitlist/?platform=macos',
    );
    await expect(page.getByRole('link', { name: 'Join for Ubuntu' })).toHaveAttribute(
      'href',
      '/waitlist/?platform=ubuntu',
    );
    await expect(page.getByRole('link', { name: 'Tell me when' })).toHaveAttribute(
      'href',
      '/waitlist/?platform=windows',
    );
    await expect(
      page.getByText('You get a .dmg for Apple silicon when the beta opens for macOS.'),
    ).toBeVisible();
    await expect(
      page.getByText('Pasting a reel link isn’t there yet: drop the reel in as a file'),
    ).toBeVisible();
    await expect(page.getByText(/You’re on/)).toHaveCount(0);
    // Each is the app on it, not a table: a mac window, an Ubuntu window, and Windows' empty outline.
    await expect(
      page.locator('section[data-platform="macos"] [data-slot="app-window"][data-platform="mac"]'),
    ).toBeVisible();
    await expect(
      page.locator('section[data-platform="ubuntu"] [data-slot="app-window"][data-platform="ubuntu"]'),
    ).toBeVisible();
    await expect(page.locator('section[data-platform="windows"] [data-slot="empty-window"]')).toBeVisible();
  });
});

const CASES = [
  {
    platform: 'Linux',
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    first: 'ubuntu',
    words: 'You’re on Linux',
  },
  {
    platform: 'Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    first: 'windows',
    words: 'You’re on Windows',
  },
  {
    platform: 'macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    first: 'macos',
    words: 'You’re on a Mac',
  },
] as const;

for (const c of CASES) {
  test(`on ${c.platform}, its platform comes first with "${c.words}"`, async ({ page }) => {
    await as(page, c.platform, c.ua);
    await page.goto('/download/');
    await expect
      .poll(() => order(page))
      .toEqual([c.first, ...['macos', 'ubuntu', 'windows'].filter((p) => p !== c.first)]);
    const yours = page.locator(`section[data-platform="${c.first}"]`);
    await expect(yours).toHaveAttribute('data-yours', 'true');
    await expect(yours.getByText(c.words)).toBeVisible();
    await expect(page.locator('section[data-yours]')).toHaveCount(1);
    // Tab order follows what you see: the first block's join link comes before the next block's.
    const links = await blocks(page).evaluateAll((els) =>
      els.map((el) => el.querySelector('a[href^="/waitlist/"]')?.getAttribute('href')),
    );
    expect(links[0]).toBe(`/waitlist/?platform=${c.first}`);
  });
}

test('on a phone, the order stays and nothing says whose it is', async ({ page }) => {
  await as(
    page,
    'Android',
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  );
  await page.goto('/download/');
  await page.waitForLoadState('networkidle');
  expect(await order(page)).toEqual(['macos', 'ubuntu', 'windows']);
  await expect(page.locator('section[data-yours]')).toHaveCount(0);
});

test('the lane’s pages never scroll sideways at 390 and 320 px', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['/download/', '/contact/', '/waitlist/']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} at ${width} px`).toBeLessThanOrEqual(0);
    }
  }
});
