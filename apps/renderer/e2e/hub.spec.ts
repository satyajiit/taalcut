// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B12, P3-V8 "the hub in the app": browse with search, filter pills and the sort pill (ratings, "New" under 3);
// a template's page plays its structure, copies into the library (Open my copy), rates and reports; Share sends only
// with the CC0 tick and says why the hub refuses; each state (offline with a cached index and Try again, the rate
// limit on the list, Local only, not set up, removed, a newer format); axe in light and dark with the dialogs open;
// en-XA without English or clipping. Against the fake hub (src/backend/fake/phase3/hub): 40 templates,
// `hub: { state, rateLimited, submission }` in taalcut.fake. UX4 tpl: the hub is Start from… › Community, its rows
// are Start from… cards (Use for a video, Copy to my templates), and a template's Share is on its Details page.
import { expect, test, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { expectPseudoCleanWithin } from './templates-support.ts';
import { expectAccessible, shoot } from './ui2b-support.ts';
import { FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';

const CAFE = '01K7C5M6Q8H000000000000001';
const HIDDEN = '01K7C5M6Q8H000000000000017';
const NEWER = '01K7C5M6Q8H000000000000018';
const GOLDEN = '01K7C5M6Q85000000000000001';
const HUB = { name: 'hub', path: '/templates/start/community' };
const DETAIL = { name: 'hub-detail', path: `/templates/start/community/${CAFE}` };
const TEMPLATE = { name: 'template-details', path: `/templates/${GOLDEN}/details` };

interface HubFake {
  readonly state?: 'offline' | 'notConfigured' | 'localOnly';
  readonly rateLimited?: boolean;
  readonly submission?: 'open' | 'merged' | 'closed';
}

async function hubFake(page: Page, hub: HubFake = {}, extra: Record<string, unknown> = {}) {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ speed: 0, latencyMs: 0, hub, ...extra }),
  });
}

const rows = (page: Page) => page.locator('[data-slot=hub-cards] [data-slot=start-card]');
const row = (page: Page, name: string) =>
  rows(page).filter({ has: page.getByRole('link', { name, exact: true }) });
/** A card's way to its page: its name, a link. */
const OPEN = '[data-slot=hub-card-open]';
const ran = async (page: Page) => (await backend.dispatched(page)).map((d) => `${d.name}:${d.source}`);
const shareDialog = (page: Page) => page.getByRole('dialog', { name: 'Share to the template hub' });
const filters = (page: Page) => page.locator('[data-slot=hub-filters]');

/** The template's Details page: Share to the community…. */
async function openShare(page: Page) {
  await page.locator('[data-slot=share-to-hub]').click();
}

test.beforeEach(async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
});

test.describe('the template hub (P3-B12, P3-V8)', () => {
  test('browses with search, filters and sorts in the URL; ratings and "New" through Intl', async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await hubFake(page);
    await open(page, HUB);
    await expect(rows(page)).toHaveCount(20);
    await expect(row(page, 'Puppy first day').locator('[data-slot=hub-rating]')).toHaveText('4.8(97)');
    await expect(row(page, 'Monsoon diaries').locator('[data-slot=hub-rating]')).toContainText('New');
    await expectAccessible(page, testInfo, 'hub light');
    await shoot(page, 'hub-browse-light');

    // The filters are the Library's pills, in one row with the sort at its end (UX1 M11).
    const pills = filters(page).locator('[data-slot=filter-pill], [data-slot=sort-pill]');
    const tops = await pills.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size, 'the filter row stays one line at 1280').toBe(1);
    await filters(page).getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitemradio', { name: 'Hindi' }).click();
    await expect(page).toHaveURL(/lang=hi/);
    await expect(rows(page)).toHaveCount(7);
    await page.getByRole('searchbox', { name: 'Find in the hub' }).fill('nani');
    await expect(page).toHaveURL(/q=nani/);
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows(page)).toHaveCount(20);
    await filters(page).locator('[data-slot=sort-pill]').click();
    await page.getByRole('menuitemradio', { name: 'Newest' }).click();
    await expect(page).toHaveURL(/sort=newest/);
    await filters(page).getByRole('button', { name: 'Tags' }).click();
    await page.getByRole('menuitemcheckbox', { name: '#food' }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/tags=food/);
    for (const name of await rows(page).locator(OPEN).allTextContents())
      expect(name.length).toBeGreaterThan(0);
    await page.getByRole('searchbox', { name: 'Find in the hub' }).fill('underwater wedding');
    await expect(page.getByText('No templates match.')).toBeVisible();
    await page.getByRole('button', { name: 'Show more' }).waitFor({ state: 'detached' });
    expect(problems).toEqual([]);
  });

  test('a card plays its strip on focus; Return opens its page, which plays the structure', async ({
    page,
  }) => {
    await hubFake(page);
    await open(page, HUB);
    const first = rows(page).first();
    await first.locator(OPEN).focus();
    await expect(first.locator('[data-slot=structure-preview]')).toHaveAttribute('data-playing', '');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/templates\/start\/community\/[0-9A-Z]{26}$/);
    await expect(page.locator('[data-slot=hub-detail] [data-slot=structure-preview]')).toHaveAttribute(
      'data-mode',
      'frame',
    );
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  test('copies with provenance, opens the copy; rates and withdraws; reports with a reason', async ({
    page,
  }, testInfo) => {
    await hubFake(page);
    await open(page, DETAIL);
    // Its name is the window bar's (Templates › Start from… › Community › Morning café), not repeated on the page.
    await expect(page.locator('h1')).toContainText('Morning café');
    await expectAccessible(page, testInfo, 'hub detail light');
    await shoot(page, 'hub-detail-light');

    await page.getByRole('radio', { name: '5 stars' }).click();
    await expect(page.getByText('Thanks for rating')).toBeVisible();
    await expect(
      page.locator('[data-slot=hub-rate]').getByRole('radio', { name: '5 stars' }),
    ).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByText('Rating withdrawn')).toBeVisible();

    await page.getByRole('button', { name: 'Report…' }).click();
    const report = page.getByRole('dialog', { name: 'Report this template' });
    await expect(report.getByRole('button', { name: 'Send report' })).toBeDisabled();
    await report.getByLabel('It’s spam or an ad').check();
    await report.getByLabel('Note (optional)').fill('The same as another one');
    await expectAccessible(page, testInfo, 'report dialog light');
    await report.getByRole('button', { name: 'Send report' }).click();
    await expect(report.getByText('Thanks. A maintainer will look at it.')).toBeVisible();
    await report.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: 'Copy to my templates' }).click();
    await expect(page.getByText('In your templates')).toBeVisible();
    await page.getByRole('button', { name: 'Open my copy' }).click();
    await expect(page).toHaveURL(/\/templates\/[0-9A-Z]{26}$/);
    await expect(page.locator('h1')).toContainText('Morning café');
    expect(await ran(page)).toEqual(expect.arrayContaining(['hub.rate:ui', 'hub.report:ui', 'hub.fork:ui']));
  });

  test('the hub’s old addresses land in Start from… › Community, with their search (UX4 tpl)', async ({
    page,
  }) => {
    await hubFake(page);
    await open(page, { name: 'old-hub', path: '/templates/hub?q=nani' });
    await expect(page).toHaveURL(/\/templates\/start\/community\?q=nani$/);
    await expect(rows(page)).toHaveCount(1);
    await open(page, { name: 'old-hub-template', path: `/templates/hub/${CAFE}` });
    await expect(page).toHaveURL(new RegExp(`/templates/start/community/${CAFE}$`));
    await expect(page.locator('h1')).toContainText('Morning café');
  });

  test('says when a template was removed or needs a newer Taalcut', async ({ page }) => {
    await hubFake(page);
    await open(page, { name: 'hidden', path: `/templates/start/community/${HIDDEN}` });
    await expect(page.getByRole('heading', { name: 'Removed from the hub' })).toBeVisible();
    await open(page, { name: 'newer', path: `/templates/start/community/${NEWER}` });
    await expect(page.getByRole('heading', { name: 'Update Taalcut to open this template' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Check for updates' })).toHaveAttribute(
      'href',
      '/settings/updates',
    );
  });

  test('offline: the cached index browses "as of 3 hours ago"; a template can’t open', async ({ page }) => {
    await hubFake(page, { state: 'offline' });
    await open(page, HUB);
    await expect(page.locator('[data-slot=hub-index-age]')).toContainText('as of 3 hours ago');
    await expect(rows(page)).toHaveCount(20);
    // Try again asks the hub again; still offline, the line stays and the rows with it.
    await page.locator('[data-slot=hub-notices]').getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('[data-slot=hub-index-age]')).toBeVisible();
    await expect(rows(page)).toHaveCount(20);
    await shoot(page, 'hub-offline-light');
    await open(page, DETAIL);
    await expect(page.locator('[data-slot=error-line]')).toHaveAttribute('data-error-code', 'hub.offline');
  });

  test('Local only and a build without the hub say so, with the way out', async ({ page }, testInfo) => {
    await hubFake(page, {}, { localOnly: true });
    await open(page, HUB);
    await expect(page.getByRole('heading', { name: 'The hub is off while Local only is on' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Privacy' })).toHaveAttribute(
      'href',
      '/settings/privacy',
    );
    await expectAccessible(page, testInfo, 'hub local only');
    await shoot(page, 'hub-local-only-light');
  });

  test('rate-limited: the list says what waits and until when once the hub refuses a rating (UX1)', async ({
    page,
  }) => {
    await hubFake(page, { rateLimited: true });
    await open(page, HUB);
    await expect(page.locator('[data-slot=hub-rate-limited]')).toHaveCount(0);
    await rows(page).first().locator(OPEN).click();
    await page.locator('[data-slot=hub-rate]').getByRole('radio', { name: '4 stars' }).click();
    await expect(page.locator('[data-slot=hub-rate] [data-slot=error-line]')).toHaveAttribute(
      'data-error-code',
      'hub.rate_limited',
    );
    await page.goBack();
    await expect(page.locator('[data-slot=hub-rate-limited]')).toHaveText(
      'The hub asked Taalcut to slow down. Rating, reporting and sharing work again in 12 minutes; browsing and copying still work.',
    );
    await expect(rows(page)).toHaveCount(20);
    await shoot(page, 'hub-rate-limited-light');
  });

  test('a copy of Taalcut without the hub says so, in words', async ({ page }) => {
    await hubFake(page, { state: 'notConfigured' });
    await open(page, HUB);
    await expect(
      page.getByRole('heading', { name: 'The hub isn’t set up in this copy of Taalcut' }),
    ).toBeVisible();
    await shoot(page, 'hub-not-configured-light');
  });

  test('Share sends only with "I understand" ticked, then shows the submission', async ({
    page,
  }, testInfo) => {
    await hubFake(page);
    await open(page, TEMPLATE);
    await openShare(page);
    const dialog = shareDialog(page);
    await expect(dialog.locator('[data-slot=share-problems][data-state=clear]')).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Not shared' })).toContainText(
      'Your video and its frames',
    );
    const submit = dialog.getByRole('button', { name: 'Submit for review' });
    await expect(submit).toBeDisabled();
    await expect(dialog.locator('[data-slot=share-reason]')).toHaveText(
      'Choose your handle and a name first.',
    );
    await dialog.getByLabel('Your handle').fill('mira.cuts');
    await expect(dialog.locator('[data-slot=share-reason]')).toHaveText('Tick “I understand” to share.');
    await expect(submit).toBeDisabled();
    await expectAccessible(page, testInfo, 'share dialog light');
    await shoot(page, 'hub-share-light');
    expect(await ran(page)).not.toContain('hub.publish:ui');

    // A problem in the words: the hub would refuse a link, so Submit stays off and says why.
    await dialog.getByLabel('Description').fill('More at https://example.com');
    await expect(dialog.locator('[data-slot=share-problems][data-state=problems]')).toContainText(
      'It has a web address in it.',
    );
    await dialog.getByLabel('I understand').check();
    await expect(dialog.locator('[data-slot=share-reason]')).toHaveText('Fix the things above first.');
    await dialog.getByLabel('Description').fill('Twelve cuts on the beat.');
    await expect(dialog.locator('[data-slot=share-reason]')).toHaveCount(0);
    await submit.click();
    await expect(dialog.getByRole('status')).toContainText('Sent for review.');
    expect(await ran(page)).toContain('hub.publish:ui');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('In review')).toBeVisible();
  });

  test('Share says when the hub refuses: a rate limit, and Local only', async ({ page }) => {
    await hubFake(page, { rateLimited: true });
    await open(page, TEMPLATE);
    await openShare(page);
    const dialog = shareDialog(page);
    await dialog.getByLabel('Your handle').fill('mira.cuts');
    await dialog.getByLabel('I understand').check();
    await dialog.getByRole('button', { name: 'Submit for review' }).click();
    await expect(dialog.locator('[data-slot=share-refused]')).toHaveAttribute(
      'data-error-code',
      'hub.rate_limited',
    );
    await expect(dialog.getByText('You can try again in 12 minutes.')).toBeVisible();
    await shoot(page, 'hub-share-rate-limited-light');
  });

  test('Share under Local only offers Privacy', async ({ page }) => {
    await hubFake(page, {}, { localOnly: true });
    await open(page, TEMPLATE);
    await openShare(page);
    const dialog = shareDialog(page);
    await expect(dialog.locator('[data-slot=share-refused]')).toHaveAttribute(
      'data-error-code',
      'core.local_only',
    );
    await dialog.getByRole('button', { name: 'Open Privacy' }).click();
    await expect(page).toHaveURL(/\/settings\/privacy$/);
  });

  for (const [state, words] of [
    ['merged', 'In the hub'],
    ['closed', 'Not accepted'],
  ] as const)
    test(`the template page shows a submission ${state}`, async ({ page }) => {
      await hubFake(page, { submission: state });
      await open(page, TEMPLATE);
      await expect(page.getByText(words, { exact: true })).toBeVisible();
    });

  test('the hub results card on /dev/kit: every state is accessible; Copy works there', async ({
    page,
  }, testInfo) => {
    await hubFake(page);
    await open(page, { name: 'kit', path: '/dev/kit' });
    const results = page.locator('figure[data-fixture="hubResults · results"]');
    await results.scrollIntoViewIfNeeded();
    await expect(page.locator('figure[data-fixture="hubResults · removed"]')).toContainText(
      'Removed from the hub',
    );
    await expectAccessible(page, testInfo, 'kit hub cards light');
    await results
      .locator('[data-slot=hub-row]')
      .first()
      .getByRole('button', { name: 'Copy to my templates' })
      .click();
    await expect(results.getByText('In your templates')).toBeVisible();
  });
});

test.describe('dark and en-XA', () => {
  test('browse, a template and the dialogs in dark', async ({ page }, testInfo) => {
    await preferences(page, { theme: 'dark', locale: 'en' });
    await hubFake(page);
    await open(page, HUB);
    await expectAccessible(page, testInfo, 'hub dark');
    await shoot(page, 'hub-browse-dark');
    await open(page, DETAIL);
    await expectAccessible(page, testInfo, 'hub detail dark');
    await shoot(page, 'hub-detail-dark');
    await page.getByRole('button', { name: 'Report…' }).click();
    await expectAccessible(page, testInfo, 'report dialog dark');
    await page.keyboard.press('Escape');
    await open(page, TEMPLATE);
    await openShare(page);
    await expect(shareDialog(page).locator('[data-slot=share-problems][data-state=clear]')).toBeVisible();
    await expectAccessible(page, testInfo, 'share dialog dark');
    await shoot(page, 'hub-share-dark');
  });

  test('en-XA: nothing English and nothing clipped', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await hubFake(page);
    await open(page, HUB);
    // The hub's own content; the sidebar and the window bar are checked by the shell's specs.
    await expectPseudoCleanWithin(page, '[data-slot=hub]', 'hub en-XA');
    await shoot(page, 'hub-browse-en-XA');
    await open(page, DETAIL);
    await expectPseudoCleanWithin(page, '[data-slot=hub-detail]', 'hub detail en-XA');
    await open(page, TEMPLATE);
    await openShare(page);
    await expect(page.locator('[data-slot=share-problems][data-state=clear]')).toBeVisible();
    await expectPseudoCleanWithin(page, '[role=dialog]', 'share dialog en-XA');
    await shoot(page, 'hub-share-en-XA');
  });
});
