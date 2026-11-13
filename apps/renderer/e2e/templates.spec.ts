// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { TEMPLATE } from './routes.ts';
import { FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';
import { expectPseudoCleanWithin } from './templates-support.ts';

const GOLDEN = { name: 'templates-template', path: `/templates/${TEMPLATE}` };
// A template by task (UX4 tpl): its overview, then Slots, Pacing and Details, each a page of its own.
const GOLDEN_SLOTS = { name: 'templates-template-slots', path: `/templates/${TEMPLATE}/slots` };
const GOLDEN_DETAILS = { name: 'templates-template-details', path: `/templates/${TEMPLATE}/details` };

async function fakeTemplates(page: Page, options: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ indexingTickMs: 0, ...options }),
  });
}

const slots = (page: Page) => page.getByRole('listbox', { name: 'Slots' }).getByRole('option');
const toast = (page: Page) => page.locator('[data-slot=toast]').last();

test.describe('templates (P2-T6)', () => {
  test('dropping a slot is undone from the toast, a cut that wasn’t one with ⌘Z: both are one undo', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await fakeTemplates(page);
    await open(page, GOLDEN_SLOTS);
    await expect(slots(page)).toHaveCount(12);
    const fix = (item: string | RegExp) => async () => {
      await page.getByRole('button', { name: 'Fix' }).click();
      await page.getByRole('menuitem', { name: item }).click();
    };

    // BRK1-REV: the review's Fix menu holds the slot's fixes.
    await slots(page).nth(2).click();
    await fix('Drop slot 3')();
    await expect(slots(page)).toHaveCount(11);
    await expect(toast(page)).toContainText('Slot 3 dropped');
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await expect(slots(page)).toHaveCount(12);

    await slots(page).nth(1).click();
    await fix(/^Not a cut: join slot 2/)();
    await expect(slots(page)).toHaveCount(11);
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+z');
      await expect(slots(page)).toHaveCount(12, { timeout: 500 });
    }).toPass();

    const ran = (await backend.dispatched(page)).filter((d) => d.name.startsWith('template.slot.'));
    expect(ran).toEqual([
      { name: 'template.slot.drop', source: 'ui' },
      { name: 'template.slot.merge', source: 'ui' },
    ]);
    expect(problems).toEqual([]);
  });

  test('renaming a slot from the keyboard, and approving the rest once nothing is left to check', async ({
    page,
  }) => {
    await fakeTemplates(page);
    await open(page, GOLDEN_SLOTS);
    await slots(page).nth(3).click();
    await page.keyboard.press('Enter');
    const field = page.getByRole('textbox', { name: 'Name for slot 4' });
    await expect(field).toBeFocused();
    await field.fill('Chai pour');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 3, name: 'Slot 4 of 12: Chai pour' })).toBeVisible();

    await page.getByRole('button', { name: 'Approve the rest (10)' }).click();
    await expect(page.getByText('Every slot approved')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Approve the rest/ })).toHaveCount(0);
  });

  test('an older version opens read-only from Details’ versions, and stays read-only on every page', async ({
    page,
  }) => {
    await fakeTemplates(page);
    await open(page, GOLDEN_DETAILS);
    const versions = page.locator('[data-slot=template-versions]');
    await expect(versions.getByText('Version 2, latest')).toBeVisible();
    await versions
      .locator('[data-slot=list-row]', { hasText: /^Version 1/ })
      .getByRole('button', { name: 'Read it' })
      .click();
    await expect(page).toHaveURL(/version=1/);
    const older = page.getByRole('status').filter({ hasText: 'Older versions can’t be changed' });
    await expect(older).toBeVisible();
    // The version goes with you to the template's other pages.
    await page.getByRole('navigation', { name: 'Template' }).getByRole('link', { name: 'Slots' }).click();
    await expect(page).toHaveURL(/\/slots\?version=1/);
    await expect(older).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fix' })).toHaveCount(0);
    await older.getByRole('button', { name: 'Back to the latest' }).click();
    await expect(page).not.toHaveURL(/version=/);
    await expect(page.getByRole('button', { name: 'Fix' })).toBeVisible();
  });

  test('the overview leads with Make a video with this, and its slots on the reel’s sound (UX4 tpl)', async ({
    page,
  }) => {
    await fakeTemplates(page);
    await open(page, GOLDEN);
    const make = page.locator('[data-slot=make-video]');
    await expect(make).toHaveText('Make a video with this');
    // The slot strip on the waveform survives (research §5), and a slot picked there opens in Slots.
    await expect(page.locator('[data-slot=template-overview] [data-slot=rhythm-bed]')).toBeVisible();
    await slots(page).nth(2).click();
    await expect(page.locator('[data-slot=overview-slot]')).toContainText('Slot 3');
    await page.getByRole('link', { name: 'Open in Slots' }).click();
    await expect(page).toHaveURL(new RegExp(`/templates/${TEMPLATE}/slots\\?slot=3$`));
    await expect(slots(page).nth(2)).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await make.click();
    await expect(page).toHaveURL(/\/chat\/[0-9A-Z]{26}$/);
    await expect(page.locator('[data-slot=chat-message][data-role=user]').first()).toContainText(
      'Make a video with my template',
    );
  });

  test('the list opens a template; finding one narrows the list', async ({ page }) => {
    await fakeTemplates(page);
    await open(page, { name: 'templates', path: '/templates' });
    const rows = page.locator('[data-slot=template-row]');
    await expect(rows).toHaveCount(3);
    await rows.filter({ hasText: 'Golden hour market' }).click();
    await expect(page).toHaveURL(new RegExp(`/templates/${TEMPLATE}$`));
    await expect(page.locator('h1')).toContainText('Golden hour market');
  });

  test('no templates yet: the link field, with Kaatu', async ({ page }) => {
    await fakeTemplates(page, { templates: 'empty' });
    await open(page, { name: 'templates', path: '/templates' });
    await expect(page.getByRole('heading', { name: 'No templates yet' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Link to a reel' })).toBeVisible();
  });
});

const TEMPLATES = { name: 'templates', path: '/templates' };
const START = { name: 'templates-start', path: '/templates/start' };
const FORMATS = { name: 'templates-start-formats', path: '/templates/start/formats' };

/** How many visible elements wear the marigold fill (the primary token), measured against a probe of it. */
async function marigoldFills(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.className = 'bg-primary';
    document.body.append(probe);
    const marigold = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.checkVisibility() && getComputedStyle(el).backgroundColor === marigold)
      .map((el) => el.textContent?.trim().slice(0, 40) ?? el.tagName);
  });
}

/** The tops of these elements, rounded: one value means one line. */
const tops = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top)))]);

test.describe('Templates page and template bar (UX1 W2-4)', () => {
  test.beforeEach(async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
  });

  test('one job a page: Your templates is the list; New, Start from… and Saved are views (UX4 tpl)', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await fakeTemplates(page);
    await open(page, TEMPLATES);
    const order = await page
      .locator(
        '[data-slot=templates-views], [data-slot=add-template], [data-slot=templates], [data-slot=starters]',
      )
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-slot')));
    // The list alone: making one and the ready-made shapes are their own pages now.
    expect(order).toEqual(['templates-views', 'templates']);
    const views = page.getByRole('navigation', { name: 'Templates' });
    await expect(views.getByRole('link', { name: 'Your templates' })).toHaveAttribute('aria-current', 'page');
    await expect(views.getByRole('link', { name: 'New' })).toHaveAttribute('href', '/templates/new');
    await expect(views.getByRole('link', { name: 'Start from…' })).toHaveAttribute(
      'href',
      '/templates/start',
    );
    await expect(views.getByRole('link', { name: 'Saved on Instagram' })).toHaveAttribute(
      'href',
      '/templates/saved',
    );

    // New: a reel's link, then Import… for files from someone.
    await views.getByRole('link', { name: 'New' }).click();
    await expect(page).toHaveURL(/\/templates\/new$/);
    const band = page.locator('[data-slot=add-template]');
    await expect(band.getByRole('textbox', { name: 'Link to a reel' })).toBeVisible();
    await expect(
      page.locator('[data-slot=templates-import]').getByRole('button', { name: 'Import…' }),
    ).toBeVisible();

    // Start from…: its own views, and every card ends with Use for a video.
    await page
      .getByRole('navigation', { name: 'Templates' })
      .getByRole('link', { name: 'Start from…' })
      .click();
    await expect(page).toHaveURL(/\/templates\/start$/);
    const start = page.getByRole('navigation', { name: 'Start from…' });
    await expect(start.getByRole('link', { name: 'Starters' })).toHaveAttribute('aria-current', 'page');
    await expect(start.getByRole('link', { name: 'Formats' })).toHaveAttribute(
      'href',
      '/templates/start/formats',
    );
    await expect(start.getByRole('link', { name: 'Community' })).toHaveAttribute(
      'href',
      '/templates/start/community',
    );
    const cards = page.locator('[data-slot=starters] [data-slot=start-card]');
    await expect(cards).not.toHaveCount(0);
    for (const card of await cards.all()) {
      await expect(card.locator('[data-action=use]')).toHaveText('Use for a video');
      await expect(card.locator('[data-action=copy]')).toHaveText('Copy to my templates');
    }
    expect(problems).toEqual([]);
  });

  test('a starter: Copy to my templates keeps it, then opens the copy (UX4 tpl)', async ({ page }) => {
    await fakeTemplates(page);
    await open(page, START);
    const card = page.locator('[data-slot=starters] [data-slot=start-card]').first();
    await card.locator('[data-action=copy]').click();
    await expect(card.getByRole('status')).toHaveText('In your templates');
    await card.locator('[data-action=open-copy]').click();
    await expect(page).toHaveURL(/\/templates\/[0-9A-Z]{26}$/);
    expect((await backend.dispatched(page)).map((d) => d.name)).toContain('template.addStarter');
  });

  for (const width of [1024, 1280])
    test(`at ${width}: Start from… cards wrap with equal heights and nothing clipped; filters on one line at 1280`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await fakeTemplates(page);
      await open(page, START);
      const tiles = page.locator('[data-slot=starters] > li');
      await expect(tiles).not.toHaveCount(0);
      const boxes = await tiles.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
      expect(new Set(boxes.map((box) => Math.round(box.height))).size, 'one tile height').toBe(1);
      const grid = await page
        .locator('[data-slot=starters]')
        .evaluate((el) => el.getBoundingClientRect().right);
      for (const box of boxes) expect(box.right).toBeLessThanOrEqual(grid + 1);
      const scroller = await page
        .locator('[data-slot=starters]')
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(scroller, 'no hidden sideways scroll').toBeLessThanOrEqual(1);
      if (width === 1280) {
        await open(page, TEMPLATES);
        expect(
          await tops(
            page,
            '[data-slot=templates-filters] [data-slot=filter-pill], [data-slot=templates-filters] [data-slot=sort-pill]',
          ),
        ).toHaveLength(1);
      }
    });

  test('one marigold fill: not the row checkboxes or the favourite stars', async ({ page }) => {
    await fakeTemplates(page);
    await open(page, TEMPLATES);
    const first = page.locator('[data-slot=template-row]').first();
    await first.hover();
    await first.locator('[data-slot=row-check]').click();
    await expect(page.locator('[data-slot=bulk-bar]')).toBeVisible();
    // With a row picked the bar's action may be the one; the checkbox itself is ink.
    expect((await marigoldFills(page)).length).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
  });

  test('a built-in format starts a chat with its ask in the composer', async ({ page }) => {
    await fakeTemplates(page);
    await open(page, FORMATS);
    await page.locator('[data-format=vlog] [data-action=use]').click();
    await expect(page).toHaveURL(/\/chat\/[0-9A-Z]{26}$/);
    await expect(page.getByRole('textbox', { name: 'Message Taalcut' })).toHaveValue(
      'Make a vlog from my clips.',
    );
  });

  test('a template’s pages are labelled views; Details has its Look, versions and sharing in words (UX4 tpl)', async ({
    page,
  }) => {
    await fakeTemplates(page);
    await open(page, GOLDEN);
    const views = page.getByRole('navigation', { name: 'Template' });
    for (const name of ['Overview', 'Slots', 'Pacing', 'Details'])
      await expect(views.getByRole('link', { name })).toBeVisible();
    await expect(views.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    await views.getByRole('link', { name: 'Details' }).click();
    await expect(page).toHaveURL(new RegExp(`/templates/${TEMPLATE}/details$`));
    // The bar keeps the template's name, a crumb back to its overview, and names the page (UX4 fix: "Templates ›
    // Golden hour market › Details"); the page's sections say what each part is.
    await expect(page.locator('h1 [data-slot=window-crumb]')).toHaveText(['Templates', 'Golden hour market']);
    await expect(page.locator('h1 [data-slot=window-title-open]')).toHaveText('Details');
    await expect(page.getByRole('button', { name: /^Look/ })).toBeVisible();
    await expect(page.locator('[data-slot=template-versions]')).toContainText('Version');
    await expect(page.locator('[data-slot=share-to-hub]')).toHaveText('Share to the community…');
    await expect(page.locator('[data-slot=export-template-file]')).toHaveText('Export file…');
  });

  test('loading shows the named skeletons captured from the real list and template', async ({ page }) => {
    await fakeTemplates(page, { libraryLatencyMs: 2500 });
    await page.goto(TEMPLATES.path);
    const list = page.locator('[data-boneyard="templates-list"][aria-busy="true"]');
    await expect(list.locator('[data-boneyard-bone]').first()).toBeVisible();
    await expect(page.locator('[data-boneyard="templates-list"]')).not.toHaveAttribute('aria-busy', 'true', {
      timeout: 6000,
    });
    await page.goto(GOLDEN.path);
    const detail = page.locator('[data-boneyard="template-detail"][aria-busy="true"]');
    await expect(detail.locator('[data-boneyard-bone]').first()).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const)
    test(`axe, ${theme}: the Templates pages and a template's`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeTemplates(page);
      for (const route of [TEMPLATES, { name: 'templates-new', path: '/templates/new' }, START, FORMATS]) {
        await open(page, route);
        await expectAccessible(page, testInfo, `${route.name} ${theme}`);
      }
      for (const route of [GOLDEN, GOLDEN_SLOTS, GOLDEN_DETAILS]) {
        await open(page, route);
        await expectAccessible(page, testInfo, `${route.name} ${theme}`);
      }
    });

  test('en-XA: the Templates page and a template have nothing English and nothing clipped', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await fakeTemplates(page);
    await open(page, TEMPLATES);
    await expectPseudoCleanWithin(page, '[data-slot=templates-page]', 'templates en-XA');
    for (const route of [GOLDEN, GOLDEN_SLOTS, GOLDEN_DETAILS]) {
      await open(page, route);
      await expectPseudoCleanWithin(page, '[data-slot=template-page]', `${route.name} en-XA`);
    }
    for (const route of [START, FORMATS]) {
      await open(page, route);
      await expectPseudoCleanWithin(page, '[data-slot=start-from]', `${route.name} en-XA`);
    }
  });
});
