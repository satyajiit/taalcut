// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P1-H7 and P3-R2: axe runs on every route in light and dark (WCAG 2.0 – 2.2 A and AA rules, target size on;
// e2e/axe.ts), and CI fails on any violation. Interactive states that only exist after a click (⌘K, Advanced,
// dialogs, and wave 4's menus, panels and cards in a11y-states.spec.ts) are checked too.
import { expect, test } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { ROUTES } from './routes.ts';
import { open, preferences } from './support.ts';

for (const theme of ['light', 'dark'] as const) {
  test.describe(`axe, ${theme} theme`, () => {
    for (const route of ROUTES) {
      test(route.name, async ({ page }, testInfo) => {
        await preferences(page, { theme, locale: 'en' });
        await open(page, route);
        await expectAccessible(page, testInfo, `${route.path} (${theme})`);
      });
    }

    test('the sidebar folded to its icon rail, with a tooltip open', async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await page.addInitScript(() => window.localStorage.setItem('taalcut.sidebar', 'collapsed'));
      await open(page, { name: 'library', path: '/library' });
      await expect(page.locator('[data-slot=sidebar][data-rail]')).toBeVisible();
      await expectAccessible(page, testInfo, `Icon rail (${theme})`);
      const areas = page.getByRole('navigation', { name: 'Areas' });
      await areas.getByRole('link', { name: 'Library' }).focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('tooltip')).toHaveText('Templates');
      await expectAccessible(page, testInfo, `Icon rail, tooltip (${theme})`);
    });

    test('the composer’s menus: models and thinking', async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await open(page, { name: 'chat-seeded', path: '/chat/01K7C5M6Q8R9S0T1V2W3X4Y5Z6' });
      await page.getByRole('button', { name: /^Model:/ }).focus();
      await page.keyboard.press('Enter');
      // Focus moves into the menu, onto the current model (GPT-6.1 Sol, the first).
      await expect(page.getByRole('listbox', { name: 'Models' }).getByRole('option').first()).toBeFocused();
      await expectAccessible(page, testInfo, `Composer, models (${theme})`);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Thinking:/ }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('slider', { name: 'Thinking' })).toBeFocused();
      await expectAccessible(page, testInfo, `Composer, thinking (${theme})`);
    });

    test('states behind a click: ⌘K, Advanced, a key form, the warning, a dialog', async ({
      page,
    }, testInfo) => {
      // Five pages and five axe scans: about half the default budget on an idle machine.
      test.slow();
      await preferences(page, { theme, locale: 'en' });
      await open(page, { name: 'library', path: '/library' });
      await page.keyboard.press('ControlOrMeta+k');
      await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeFocused();
      await expectAccessible(page, testInfo, `⌘K (${theme})`);
      await page.keyboard.type('theme');
      await expectAccessible(page, testInfo, `⌘K filtered (${theme})`);
      await page.keyboard.press('Escape');

      await open(page, { name: 'settings-models', path: '/settings/models?advanced=true' });
      await expect(page.getByRole('region', { name: 'Agent' })).toBeVisible();
      await expectAccessible(page, testInfo, `Models, Advanced (${theme})`);

      // Accounts' forms, each on its view (UX4): a key's field, Claude's warning card, the servers' addresses.
      await open(page, { name: 'settings-accounts-keys', path: '/settings/accounts/keys' });
      await page.getByRole('button', { name: 'Add key' }).first().click();
      await expectAccessible(page, testInfo, `Accounts › Keys, a form open (${theme})`);
      await open(page, { name: 'settings-accounts-subscriptions', path: '/settings/accounts/subscriptions' });
      await page.getByRole('button', { name: 'Sign in to Claude' }).click();
      await expectAccessible(page, testInfo, `Accounts › Subscriptions, a warning open (${theme})`);
      await open(page, { name: 'settings-accounts-servers', path: '/settings/accounts/servers' });
      await expectAccessible(page, testInfo, `Accounts › Servers (${theme})`);

      await open(page, { name: 'dev-traces', path: '/dev/traces?run=01K7C9A0B0000000000000GATE' });
      await page
        .getByRole('button', { name: /vision\.describeFrame/ })
        .first()
        .click();
      await expectAccessible(page, testInfo, `Trace span details (${theme})`);

      await open(page, { name: 'dev-kit', path: '/dev/kit' });
      await page.locator('[data-slot=card]').getByRole('button', { name: 'Delete project' }).click();
      await expect(page.getByRole('dialog', { name: 'Delete this project?' })).toBeVisible();
      await expectAccessible(page, testInfo, `Kit dialog (${theme})`);
    });
  });
}
