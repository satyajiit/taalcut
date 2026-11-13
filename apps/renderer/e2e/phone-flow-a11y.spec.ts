// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The phone flow (UX1) in the states the route-wide checks never reach (they open each tab with nothing
// connected): axe in light and dark, the keyboard through the tabs, and the pseudo-locale and Hindi with a phone
// connected and files arriving, a phone on the cable, a failure and Help's flagged row.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import {
  clippedText,
  englishPhrases,
  type Finding,
  englishShowing,
  translatedPhrases,
  untranslated,
  userFacingText,
} from './inspect.ts';
import { FocusLog, walkTabs } from './keyboard.ts';
import { band, fakePhone, onTab, tab, openPhone, followReception, openHelp } from './phone-flow-support.ts';
import { open, preferences } from './support.ts';

/**
 * The fake's recent chats in the sidebar carry their title in a `title` attribute outside `translate="no"`, so the
 * pseudo-locale check counts the person's own words as untranslated on every page. Pre-existing on main (2de0ff8b),
 * reported in _orch/ux1/specs/requests-oc-to-orchestrator.md; this spec checks the phone flow's own strings.
 */
const SIDEBAR_CHATS = new Set(['Trip to Goa reel', 'Diwali highlights', 'Product teaser, 15 s']);
const ours = (found: readonly Finding[]) =>
  found.filter((finding) => !(SIDEBAR_CHATS.has(finding.text) && finding.where.endsWith('@title')));

interface PhoneState {
  name: string;
  /** Opens the flow and waits until the state shows. */
  reach(page: Page): Promise<void>;
}

const STATES: readonly PhoneState[] = [
  {
    name: 'Wi-Fi, a phone connected',
    async reach(page) {
      await fakePhone(page, { transfer: 'connected', transferSpeed: 4 });
      await openPhone(page);
      await expect(page.locator('[data-slot=connection]')).toHaveAttribute('data-connection', 'connected');
    },
  },
  {
    name: 'Transfers, files arriving',
    async reach(page) {
      await fakePhone(page, { transfer: 'phone', transferSpeed: 4 });
      await openPhone(page);
      await expect(page.locator('[data-slot=connection]')).toHaveAttribute('data-connection', 'connected');
      await followReception(page);
      await onTab(page, 'transfers');
      await expect(page.locator('[data-slot=transfer-file]').first()).toBeVisible();
    },
  },
  {
    name: 'Cable, a phone found',
    async reach(page) {
      await fakePhone(page, { transfer: 'waiting', usb: 'iphone' });
      await open(page, tab('cable'));
      // The phone is found: the second beat is current and holds its button.
      await expect(page.locator('[data-action=import-connect]')).toBeVisible();
    },
  },
  {
    name: 'Wi-Fi, the stream failed',
    async reach(page) {
      await fakePhone(page, { transfer: 'dropped', transferSpeed: 4 });
      await openPhone(page);
      await expect(band(page)).toHaveAttribute('data-state', 'failed', { timeout: 10_000 });
    },
  },
  {
    name: 'Help, a VPN flagged',
    async reach(page) {
      await fakePhone(page, { transfer: 'blocked' });
      await openPhone(page);
      await expect(page.locator('[data-slot=qr-code]')).toBeVisible();
      await openHelp(page);
      await onTab(page, 'help');
      await expect(page.locator('[data-flagged]')).toHaveCount(1);
    },
  },
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`phone flow, axe, ${theme} theme`, () => {
    for (const state of STATES) {
      test(state.name, async ({ page }, testInfo) => {
        await preferences(page, { theme, locale: 'en' });
        await state.reach(page);
        await expectAccessible(page, testInfo, `${state.name} (${theme})`);
      });
    }

    test('while it starts: the bones', async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakePhone(page, { transfer: 'starting' });
      await page.goto(tab('wifi').path);
      await page.locator('[data-action=wifi-connect]').click();
      await expect(page.locator('[data-boneyard=phone-pairing][aria-busy=true]')).toBeVisible();
      await expectAccessible(page, testInfo, `Wi-Fi, starting (${theme})`);
    });
  });
}

test.describe('phone flow, keyboard', () => {
  test.use({ hasTouch: false });

  test('keyboard reaches connection help and opens it', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakePhone(page, { transfer: 'waiting' });
    await openPhone(page);
    const help = page.locator('a[href="/library/import/phone-wifi/help"]').last();
    await help.focus();
    await expect(help).toBeFocused();
    await page.keyboard.press('Enter');
    await onTab(page, 'help');
  });

  for (const state of STATES.slice(0, 3)) {
    test(`${state.name}: every Tab stop is shown and in view`, async ({ page }) => {
      await preferences(page, { theme: 'light', locale: 'en' });
      await state.reach(page);
      const log = new FocusLog();
      const stops = await walkTabs(page, log, state.name);
      expect(stops).toBeGreaterThan(0);
      expect(log.problems, `focus stops:\n${log.stops.join('\n')}`).toEqual([]);
    });
  }
});

test.describe('phone flow, languages', () => {
  // The minimum the window is likely to be: long translations have the least room.
  test.use({ viewport: { width: 1024, height: 720 } });
  const english = englishPhrases();
  const hindi = translatedPhrases('hi');

  for (const state of STATES) {
    test(`en-XA, ${state.name}: everything translated, nothing clipped`, async ({ page }) => {
      await preferences(page, { theme: 'light', locale: 'en-XA' });
      await state.reach(page);
      const text = await userFacingText(page);
      expect(englishShowing(text, english), 'English source strings on screen').toEqual([]);
      expect(ours(untranslated(text)), 'strings that skipped the catalogue').toEqual([]);
      expect(await clippedText(page), 'text that does not fit').toEqual([]);
    });

    test(`hi, ${state.name}: no English left, nothing clipped`, async ({ page }) => {
      await preferences(page, { theme: 'dark', locale: 'hi' });
      await state.reach(page);
      await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
      expect(englishShowing(await userFacingText(page), hindi), 'English on a Hindi page').toEqual([]);
      expect(await clippedText(page), 'text that does not fit').toEqual([]);
    });
  }
});
