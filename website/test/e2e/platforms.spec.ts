// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';
import { RELEASE } from '../../src/content/release';

/**
 * /download/: the download for a Mac, the three steps and the facts beside it, then each platform as Taalcut running
 * on it. The Mac, which has the download, is first whatever the visitor's computer; the script reads the browser's
 * platform and gives that block its "You're on…" sticker. Also: the lane's pages at 390 and 320 px without sideways
 * scroll, and /waitlist/, which is closed and says where the download is.
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

  test('gives the Mac its download, the steps and the facts, and says the other two have none', async ({
    page,
  }) => {
    await page.goto('/download/');
    const main = page.locator('main');
    // The button is the .dmg itself on the release, and GitHub is beside it; both are plain links.
    const download = main.getByRole('link', { name: 'Download for Mac' });
    await expect(download).toHaveCount(1);
    await expect(download).toHaveAttribute('href', RELEASE.download);
    await expect(main.locator('[data-slot="github-link"]')).toHaveText('GitHub');
    await expect(main.locator('[data-slot="github-link"]')).toHaveAttribute(
      'href',
      'https://github.com/satyajiit/taalcut',
    );
    await expect(main.getByText(`${RELEASE.name} · Free · Apple silicon, macOS 14 or later`)).toBeVisible();
    await expect(
      main.getByText(/the default on-device model often doesn’t finish a make by itself/),
    ).toHaveCount(2);
    expect(await order(page)).toEqual(['macos', 'ubuntu', 'windows']);
    await expect(page.getByRole('heading', { level: 2, name: 'Apple silicon Macs' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Ubuntu 24.04' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Windows' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Release notes and checksums' })).toHaveAttribute(
      'href',
      RELEASE.page,
    );
    await expect(
      main.getByText(`You get ${RELEASE.name} as a .dmg, signed with a Developer ID and notarized by Apple.`),
    ).toBeVisible();
    // The three steps, in order, and the facts under them.
    const install = page.locator('section#install');
    await expect(install.getByRole('heading', { level: 2 })).toHaveText('Install it in three steps');
    await expect(install.locator('ol > li h3')).toHaveText([
      'Download the .dmg',
      'Drag it into Applications',
      'Open Taalcut',
    ]);
    await expect(install.locator('dt')).toHaveText([
      'Signed and notarized',
      'What to expect',
      'Language',
      'Notes and checksums',
      'Build it from source',
      'Something wrong?',
    ]);
    await expect(install.getByRole('link', { name: `${RELEASE.version} release` })).toHaveAttribute(
      'href',
      RELEASE.page,
    );
    await expect(install.getByRole('link', { name: RELEASE.file })).toHaveAttribute('href', RELEASE.fileUrl);
    await expect(install.getByRole('link', { name: 'issues' })).toHaveAttribute('href', RELEASE.issues);
    // Ubuntu and Windows: no download, said in words, and nothing to join.
    const ubuntu = page.locator('section[data-platform="ubuntu"]');
    await expect(ubuntu.getByText('No download yet', { exact: true })).toBeVisible();
    await expect(ubuntu.getByText('No Ubuntu download yet, and no date for one.')).toBeVisible();
    await expect(ubuntu.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/satyajiit/taalcut',
    );
    const windows = page.locator('section[data-platform="windows"]');
    await expect(windows.getByText('No Windows download yet.')).toBeVisible();
    await expect(windows.getByRole('link')).toHaveCount(0);
    await expect(page.locator('main a[href*="/waitlist/"]')).toHaveCount(0);
    await expect(page.locator('main form, main input')).toHaveCount(0);
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
  test(`on ${c.platform}, its platform says "${c.words}" and the Mac stays first`, async ({ page }) => {
    await as(page, c.platform, c.ua);
    await page.goto('/download/');
    const yours = page.locator(`section[data-platform="${c.first}"]`);
    await expect(yours).toHaveAttribute('data-yours', 'true');
    await expect(yours.getByText(c.words)).toBeVisible();
    await expect(page.locator('section[data-yours]')).toHaveCount(1);
    // The download is the Mac's, so its block leads whatever the visitor's computer.
    expect(await order(page)).toEqual(['macos', 'ubuntu', 'windows']);
  });
}

test('/waitlist/ is closed: it says Taalcut is out, offers the download and GitHub, and asks for nothing', async ({
  page,
}) => {
  await page.goto('/waitlist/?ref=ig&platform=ubuntu');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Taalcut is out.');
  await expect(main.getByText('The Taalcut waitlist is closed.', { exact: false })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Download for Mac' })).toHaveAttribute(
    'href',
    RELEASE.download,
  );
  await expect(main.getByRole('link', { name: 'GitHub', exact: true })).toHaveAttribute(
    'href',
    'https://github.com/satyajiit/taalcut',
  );
  await expect(main.locator('form, input, select, textarea, button[type="submit"]')).toHaveCount(0);
  // People who joined are told what they were promised, and where the notice is.
  const joined = main.getByRole('complementary', { name: 'If you joined the waitlist' });
  await expect(joined.locator('dt')).toHaveText(['You get', 'We keep', 'For how long', 'Leaving']);
  await expect(joined).toContainText(
    'Until 30 days after we send that one email, or until you ask us to delete it.',
  );
  await expect(joined.getByRole('link', { name: 'The privacy notice says the rest' })).toHaveAttribute(
    'href',
    '/privacy/#waitlist',
  );
  // It is off the sitemap and has no Markdown mirror, and nothing loads from the forms' backend.
  expect(await (await page.request.get('/sitemap.xml')).text()).not.toContain('/waitlist/');
  expect((await page.request.get('/waitlist.md')).status()).toBe(404);
});

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
