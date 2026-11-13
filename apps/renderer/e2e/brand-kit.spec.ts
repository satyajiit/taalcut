// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-V10 "Done when": a brand kit applies in one action and survives reopening. Editing saves one style.update per
// committed field (⌘Z undoes it); a logo is refused by type and size in words, then accepted, and its corner moves
// by keyboard; the kit goes on a template in one action, after which Delete says where it's used. "Survives
// reopening": the fake lives in the page, so a browser reload would start a fresh fake; reopening the kit in the
// same session (another page, then back) shows what was saved, which is what the real store does across launches.
import { expect, test, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { fakeChat, open, preferences } from './support.ts';
import { expectAccessible, expectPseudoClean, fakeState } from './ui2b-support.ts';

const CHAI = '01K7C5M6Q8Z000000000000001';
const MONSOON = '01K7C5M6Q8Z000000000000002';
const GOLDEN_TEMPLATE = '01K7C5M6Q85000000000000001';

const KITS = { name: 'brand kits', path: '/settings/brand' };
// A kit's editor opens on its Colours view (UX4): /settings/brand/<id> lands on /settings/brand/<id>/colours.
const kit = (id: string, view = 'colours') => ({
  name: 'brand kit',
  path: `/settings/brand/${id}`,
  lands: `/settings/brand/${id}/${view}`,
});
const kitView = (id: string, view: string) => ({
  name: `brand kit ${view}`,
  path: `/settings/brand/${id}/${view}`,
});
const status = (page: Page) => page.locator('[data-slot=brand-status]');

/** A kit as the fake stores it (phase3.styles.store.get). */
function stored(page: Page, styleId: string) {
  return page.evaluate((id) => {
    const fake = (
      window as unknown as { taalcutFake: { phase3: { styles: { store: { get(id: string): unknown } } } } }
    ).taalcutFake;
    return JSON.parse(JSON.stringify(fake.phase3.styles.store.get(id))) as {
      ok: boolean;
      value: { colours: Record<string, string>; logo: { placement: string } | null; revision: number };
    };
  }, styleId);
}

const pick = (page: Page, path: string | null) =>
  page.evaluate(
    (next) =>
      (
        window as unknown as {
          taalcutFake: { phase3: { filePicks: { setPick(purpose: string, path: string | null): void } } };
        }
      ).taalcutFake.phase3.filePicks.setPick('brandImage', next),
    path,
  );

/** Settings' own sidebar. */
const settingsNav = (page: Page) => page.getByRole('navigation', { name: 'Settings' });

test.describe('brand kits (P3-V10)', () => {
  test.beforeEach(async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakeChat(page, { latencyMs: 20 });
  });

  test('the list shows each kit, the default, and opens the editor', async ({ page }, testInfo) => {
    await open(page, KITS);
    await expect(settingsNav(page).getByRole('link', { name: 'Brand kits' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const rows = page.locator('[data-slot=brand-kit-row]');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('Chai & Co.');
    await expect(rows.first()).toContainText('Default for new videos');
    await expectAccessible(page, testInfo, 'brand kits (light)');
    await rows.first().click();
    await expect(page).toHaveURL(new RegExp(`/settings/brand/${CHAI}/colours$`));
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Chai & Co.');
  });

  test('a field saves once when done, warns on low contrast, ⌘Z undoes it, and reopening keeps it', async ({
    page,
  }) => {
    await open(page, kit(CHAI));
    const text = page.getByRole('textbox', { name: 'Text', exact: true });
    // Keyboard only: type, Enter.
    await text.fill('#eeeeee');
    await text.press('Enter');
    await expect(status(page)).toHaveText('Saved. ⌘Z undoes it.');
    await expect(page.getByText(/hard to read/)).toBeVisible();
    expect((await stored(page, CHAI)).value.colours['text']).toBe('#eeeeee');
    const updates = (await backend.dispatched(page)).filter((d) => d.name === 'style.update');
    expect(updates).toEqual([{ name: 'style.update', source: 'ui' }]);
    // Not a colour: refused in words, nothing sent; Escape puts it back.
    await text.fill('reddish');
    await expect(page.getByText('Use a colour like #c2410c.')).toBeVisible();
    await text.press('Escape');
    await expect(text).toHaveValue('#eeeeee');
    // ⌘Z on this page is the app-wide history: the colour comes back.
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+z');
      await expect(text).toHaveValue('#1c1917', { timeout: 500 });
    }).toPass();
    // Save one, leave, come back: it is what the store says.
    const main = page.getByRole('textbox', { name: 'Main colour', exact: true });
    await main.fill('#123456');
    await main.blur();
    await expect(status(page)).toHaveText('Saved. ⌘Z undoes it.');
    // Settings' own sidebar: on the editor the bar's way up is a "Brand kits" link too.
    await settingsNav(page).getByRole('link', { name: 'Privacy' }).click();
    await settingsNav(page).getByRole('link', { name: 'Brand kits' }).click();
    await page.locator('[data-slot=brand-kit-row]').first().click();
    await expect(page.getByRole('textbox', { name: 'Main colour', exact: true })).toHaveValue('#123456');
  });

  test('each view is its own page, with the preview beside every one', async ({ page }) => {
    await open(page, kit(CHAI));
    const views = page.getByRole('navigation', { name: 'Brand kit' });
    await expect(views.getByRole('link', { name: 'Colours' })).toHaveAttribute('aria-current', 'page');
    for (const [view, path, region] of [
      ['Type', 'type', 'Fonts'],
      ['Captions', 'captions', 'Captions'],
      ['Logo', 'logo', 'Watermark'],
      ['Intro and outro', 'intro-outro', 'Intro and outro'],
    ] as const) {
      await views.getByRole('link', { name: view }).click();
      await expect(page).toHaveURL(new RegExp(`/settings/brand/${CHAI}/${path}$`));
      await expect(views.getByRole('link', { name: view })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('region', { name: region })).toBeVisible();
      // The name and the preview stay beside every view.
      await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Chai & Co.');
      await expect(page.locator('[data-slot=brand-preview]')).toBeVisible();
    }
    // The bar's way up is still the list.
    await expect(page.locator('[data-slot=window-crumb]')).toHaveAttribute('href', '/settings/brand');
  });

  test('a logo is refused by type and size in words, then accepted; its corner moves by keyboard', async ({
    page,
  }) => {
    await open(page, kitView(MONSOON, 'logo'));
    const choose = page.getByRole('button', { name: 'Choose image…' });
    await pick(page, '/Users/me/Pictures/logo.gif');
    await choose.click();
    await expect(page.getByRole('alert')).toContainText('Taalcut can use a PNG, JPEG or WebP image.');
    await pick(page, '/Users/me/Pictures/huge-logo.png');
    await choose.click();
    await expect(page.getByRole('alert')).toContainText('larger than 5.2 MB');
    await pick(page, '/Users/me/Pictures/giant-logo.png');
    await choose.click();
    await expect(page.getByRole('alert')).toContainText('more than 4,096 pixels on a side');
    expect((await stored(page, MONSOON)).value.logo).toBeNull();
    await pick(page, '/Users/me/Pictures/monsoon-logo.png');
    await choose.click();
    await expect(page.getByText('PNG, 512 × 512 pixels')).toBeVisible();
    expect((await stored(page, MONSOON)).value.logo?.placement).toBe('topRight');
    // The pointer-free equal of placing it: arrow keys in the corner radios.
    const corner = page.getByRole('radiogroup', { name: 'Logo corner' });
    await corner.getByRole('radio', { name: 'Top right' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(corner.getByRole('radio', { name: 'Bottom left' })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await stored(page, MONSOON)).value.logo?.placement).toBe('bottomLeft');
  });

  test('the kit goes on a template in one action; then Delete says where it is used', async ({ page }) => {
    await open(page, kit(MONSOON));
    await page.getByRole('button', { name: 'Use on a template…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Use on a template' });
    await dialog.getByRole('radio', { name: 'Golden hour market' }).check();
    await dialog.getByRole('button', { name: 'Use on this template' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-slot=toast]').last()).toContainText(
      'Golden hour market uses Monsoon Travels now',
    );
    const head = await page.evaluate(async (id) => {
      const fake = (
        window as unknown as {
          taalcutFake: {
            templates: { get(id: string): Promise<{ template: { styleId: string | null } } | null> };
          };
        }
      ).taalcutFake;
      return (await fake.templates.get(id))?.template.styleId ?? null;
    }, GOLDEN_TEMPLATE);
    expect(head).toBe(MONSOON);
    await page.getByRole('button', { name: 'More for this brand kit' }).click();
    await page.getByRole('menuitem', { name: 'Delete brand kit…' }).click();
    const remove = page.getByRole('dialog', { name: 'Delete Monsoon Travels?' });
    await expect(remove).toContainText('It’s used by 1 template.');
    await expect(remove.getByRole('button', { name: 'Delete brand kit' })).toHaveCount(0);
  });

  test('no kits yet: Kaatu and one action, which makes a kit and opens it', async ({ page }) => {
    await page.addInitScript(() =>
      window.localStorage.setItem('taalcut.fake', JSON.stringify({ latencyMs: 20, styles: 'empty' })),
    );
    await open(page, KITS);
    await expect(page.getByRole('heading', { name: 'No brand kits yet' })).toBeVisible();
    await expect(page.locator('main [data-slot=mascot]')).toHaveCount(1);
    await page.getByRole('button', { name: 'New brand kit' }).click();
    await expect(page).toHaveURL(/\/settings\/brand\/[0-9A-Z]{26}\/colours$/);
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('New brand kit');
    expect(await fakeState<{ name: string }[]>(page, 'dispatched')).toContainEqual({
      name: 'style.create',
      source: 'ui',
    });
  });

  for (const theme of ['light', 'dark'] as const)
    test(`the editor is accessible (${theme})`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await open(page, kit(CHAI));
      await expectAccessible(page, testInfo, `brand kit editor (${theme})`);
      await page.getByRole('button', { name: 'Use on a template…' }).click();
      await expect(page.getByRole('radio').first()).toBeVisible();
      await expectAccessible(page, testInfo, `use on a template (${theme})`);
    });

  test('the pseudo-locale leaves nothing English and nothing clipped', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await open(page, kit(CHAI));
    await expectPseudoClean(page, 'brand kit editor');
    for (const view of ['type', 'captions', 'logo', 'intro-outro']) {
      await open(page, kitView(CHAI, view));
      await expectPseudoClean(page, `brand kit editor, ${view}`);
    }
    await open(page, KITS);
    await expectPseudoClean(page, 'brand kits');
  });
});
