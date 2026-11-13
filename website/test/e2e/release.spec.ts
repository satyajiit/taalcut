// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test } from '@playwright/test';
import { RELEASE } from '../../src/content/release';

/**
 * The release as the pages say it: Taalcut with its number, never a stage. "Beta" is said for one thing only, the
 * app's opt-in Beta update channel, on /beta-terms/ and in the two links that lead there (the footer's and /terms/'s).
 */

const CHANNEL_LINK = 'Beta channel terms';

test('no page calls the release a beta: the word is only the footer’s link to the channel’s terms', async ({
  page,
}) => {
  for (const path of [
    '/',
    '/download/',
    '/waitlist/',
    '/features/',
    '/features/agent/',
    '/ai/',
    '/faq/',
    '/about/',
    '/press/',
    '/contact/',
    '/privacy/',
  ]) {
    await page.goto(path);
    const words = await page.evaluate(() => `${document.title}\n${document.body.innerText}`);
    expect(words.replaceAll(CHANNEL_LINK, ''), path).not.toMatch(/beta|pre-?release/i);
    const head = await page
      .locator('head meta[name="description"], head meta[property^="og:"], head meta[name^="twitter:"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('content') ?? '').join('\n'));
    expect(head, path).not.toMatch(/\bbeta\b(?!-terms)/i);
  }
});

test('/download/ names the release by its number, and its structured data carries the plain version', async ({
  page,
}) => {
  await page.goto('/download/');
  await expect(page.locator('main')).toContainText(`${RELEASE.name} is out for Macs with Apple silicon`);
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const items = blocks.flatMap((b) => [JSON.parse(b) as unknown].flat()) as Record<string, unknown>[];
  const app = items.find((i) => i['@type'] === 'SoftwareApplication');
  expect(app?.softwareVersion).toBe(RELEASE.version);
  expect(String(app?.softwareVersion)).toMatch(/^\d+\.\d+\.\d+$/);
  expect(app?.downloadUrl).toBe(RELEASE.download);
  expect(app?.releaseNotes).toBe(RELEASE.page);
  expect(app?.operatingSystem).toBe('macOS 14 Sonoma or later');
});

test('/beta-terms/ is the Beta update channel’s terms, with the app’s three lines where the app shows them', async ({
  page,
}) => {
  await page.goto('/beta-terms/');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Beta channel terms');
  await expect(main).toContainText('The Taalcut app has two update channels, Stable and Beta.');
  await expect(main).toContainText('Settings › General › Updates');
  await expect(main).not.toContainText('Settings › About');
  for (const line of [
    'Things can still break. Your clips stay on this Mac.',
    'Updates come often, and install when you restart.',
    'Sharing usage counts and crash reports is up to you. Both start off.',
  ]) {
    await expect(main.getByText(line, { exact: true })).toHaveCount(1);
  }
  // Nothing here says the product is a beta, that fuller terms are still to come, or that Ubuntu has a download.
  const words = await main.innerText();
  expect(words).not.toMatch(/public beta|before the beta|beta opens|first run/i);
  expect(words).toContain('Taalcut has no Ubuntu download yet.');
  // It is not in the main navigation: the footer and /terms/ lead here.
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /beta/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: CHANNEL_LINK }),
  ).toHaveAttribute('href', '/beta-terms/');
  await page.goto('/terms/');
  await expect(page.locator('#the-app').getByRole('link', { name: CHANNEL_LINK })).toHaveAttribute(
    'href',
    '/beta-terms/',
  );
});
