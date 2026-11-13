// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-MAC "Done when", in the browser: every page of the app and every first-run screen (not the developer pages)
// on the Linux RTX 4090 fixture shows no "Mac", "macOS", "⌘" or "Finder", nor ⌘K; on the Mac fixture the Mac's
// words are as they were. Screenshots of each page go to TAALCUT_PLATFORM_SCREENS (default
// e2e-artifacts/screenshots/platform-words/).
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { userFacingText } from './inspect.ts';
import { firstRun, openScreen, SCREENS } from './onboarding-shell-support.ts';
import { ROUTES } from './routes.ts';
import { ARTIFACTS, open, preferences, screenshotWhole } from './support.ts';
import { fakes, type Ui2bFakeOptions } from './ui2b-support.ts';

const NAMES_THE_MAC =
  /\bMacs?\b|Mac’s|macOS|MacBook|⌘|⌥|⌃|\bFinder\b|[Kk]eychain|Apple silicon|System Settings/;
const LINUX: Ui2bFakeOptions = { onboarding: 'done', system: 'linux-nvidia' };
const MAC: Ui2bFakeOptions = { onboarding: 'done', system: 'mac' };
const SHOTS =
  process.env.TAALCUT_PLATFORM_SCREENS ?? new URL('screenshots/platform-words/', ARTIFACTS).pathname;

/** The app's pages, walked with first run done (first run has its own walk below). The developer pages show the
 * Mac's window controls on purpose. */
const WALKED = ROUTES.filter(
  (route) => !route.path.startsWith('/onboarding') && !route.path.startsWith('/dev/'),
);

async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await screenshotWhole(page, new URL(`${name}.png`, `file://${SHOTS.replace(/\/?$/, '/')}`).href);
}

/** What on the page names the Mac, and where. */
async function macWords(page: Page): Promise<string[]> {
  return (await userFacingText(page))
    .filter((f) => NAMES_THE_MAC.test(f.text))
    .map((f) => `${f.text} @ ${f.where}`);
}

test.describe('on Linux', () => {
  for (const route of WALKED) {
    test(`${route.name} doesn’t name the Mac`, async ({ page }) => {
      await preferences(page, { theme: 'light', locale: 'en' });
      await fakes(page, LINUX);
      await open(page, route);
      const words = await macWords(page);
      await shoot(page, `linux-${route.name}`);
      expect(words).toEqual([]);
    });
  }

  test('first run says it in this computer’s words, its cable way too', async ({ page }) => {
    test.setTimeout(90_000);
    await preferences(page, { theme: 'light', locale: 'en' });
    await firstRun(page, 'linux-nvidia');
    for (const screen of SCREENS) {
      await openScreen(page, screen);
      expect(await macWords(page), screen).toEqual([]);
      await shoot(page, `linux-onboarding-${screen}`);
    }
    await openScreen(page, 'sources');
    await page.locator('li[data-way="cable"] > button').click();
    const cable = page.locator('[data-way-panel="cable"]');
    await expect(cable).toContainText('Cable import is unavailable on this computer');
    expect(await macWords(page)).toEqual([]);
    await shoot(page, 'linux-onboarding-sources-cable');
  });

  test('⌘K, the cable tab and the help say it in this computer’s words', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakes(page, LINUX);
    await open(page, { name: 'library-phone-cable', path: '/library/phone/cable' });
    const cable = page.locator('main');
    await expect(cable).toContainText('Cable import is unavailable on this computer');
    await cable.getByRole('link', { name: 'Connect over Wi-Fi' }).click();
    await expect(page).toHaveURL(/\/library\/import\/phone-wifi$/);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog');
    await palette.getByRole('combobox').fill('light or dark');
    await expect(palette).toContainText('Match the system’s light or dark setting');
    expect(await macWords(page)).toEqual([]);
    await shoot(page, 'linux-palette');
  });

  test('the pseudo-locale says this computer too', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await fakes(page, LINUX);
    // UX4: the hardware is General's This Mac view, named "This computer" off a Mac.
    await open(page, { name: 'settings-this-mac', path: '/settings/this-mac' });
    await expect(
      page.locator('[data-slot=settings-views]').getByRole('link', { name: '~Ţĥĩś ćōḿƥũţēŕ~', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('dl[aria-label="~Ţĥĩś ćōḿƥũţēŕ~"]')).toBeVisible();
    await expect(
      page.getByRole('region', { name: '~~~~Ŵĥēŕē ŵōŕķ ŕũńś ōń ţĥĩś ćōḿƥũţēŕ~~~~' }),
    ).toBeVisible();
    await shoot(page, 'linux-en-XA-settings-this-mac');
  });
});

test.describe('on a Mac', () => {
  test('the Mac’s words are as they were', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakes(page, MAC);
    await open(page, { name: 'settings-this-mac', path: '/settings/this-mac' });
    await expect(
      page.locator('[data-slot=settings-views]').getByRole('link', { name: 'This Mac', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('dl[aria-label="This Mac"]')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Where work runs on this Mac' })).toBeVisible();
    await shoot(page, 'mac-settings-this-mac');
    await open(page, { name: 'library-phone-cable', path: '/library/phone/cable' });
    await expect(page.locator('[data-action=import-connect]')).toBeVisible();
    await shoot(page, 'mac-library-phone-cable');
    await open(page, { name: 'settings-privacy', path: '/settings/privacy' });
    await expect(page.locator('main')).toContainText('this Mac');
    await shoot(page, 'mac-settings-privacy');
  });
});
