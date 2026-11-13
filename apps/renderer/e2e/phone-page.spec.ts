// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1 (phoneweb): every screen of the phone upload page at the brief's four widths, light and dark, then in
// Hindi and the en-XA pseudo-locale. Each screen must fit the phone (no sideways scroll, 44 px targets),
// pass axe and is photographed. The behaviour behind the screens (the PIN boxes, routing, a reload, row
// actions, motion) is phone-page-flows.spec.ts's. The page, its Mac and tus are phone-page-support.ts's.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { clippedText } from './inspect.ts';
import {
  type Device,
  DEVICES,
  expectPhoneFit,
  GALAXY_S26,
  openPhone,
  pairPhone,
  pick,
  row,
  rows,
  SENDING,
  SETTLING,
  settle,
  shot,
  typePin,
} from './phone-page-support.ts';

test.describe.configure({ timeout: 180_000 });

/** A screen is checked once it's the only one showing and its heading has the words it should. */
async function check(page: Page, testInfo: TestInfo, label: string, name: string): Promise<void> {
  await settle(page);
  await expectPhoneFit(page, label);
  await expectAccessible(page, testInfo, label);
  await shot(page, name);
}

/** The browser logs each refused request; these are the ones a test asked for. */
const expected = (problems: string[], statuses: string[]) =>
  problems.filter((problem) => !statuses.some((status) => problem.includes(status)));

for (const device of DEVICES) {
  for (const theme of ['light', 'dark'] as const) {
    const at = `${device.name}-${theme}`;

    test(`${at}: connect, a wrong PIN, choose, send, lose the Mac, wait for it, run out`, async ({ browser }, testInfo) => {
      const { page, mac, problems, close } = await openPhone(browser, device, { theme });
      await expect(page.locator('#code-field')).toBeHidden();
      await expect(page.locator('#pair-title')).toHaveText('Connect to your Mac');
      await check(page, testInfo, 'connect', `pair-${at}`);

      await typePin(page, '4829');
      await check(page, testInfo, 'connect, typing', `pair-typing-${at}`);

      await typePin(page, '11');
      await expect(page.locator('#pair-error-text')).toHaveText(
        'That PIN didn’t match. Check the digits on your Mac and try again.',
      );
      await expect(page.locator('#pin')).toHaveAttribute('data-state', 'error');
      await expect(page.locator('#pin-hint')).toBeHidden();
      await check(page, testInfo, 'wrong PIN', `pair-wrong-${at}`);

      await pairPhone(page);
      await expect(page.locator('.pick:not([hidden])')).toHaveCount(device.picker === '#pick-any' ? 1 : 2);
      await check(page, testInfo, 'choose', `choose-${at}`);

      await pick(page, device, SENDING);
      await expect(page.locator('#screen-sending')).toBeVisible();
      await expect(rows(page)).toHaveCount(SENDING.length);
      await expect(row(page, 'IMG_0412').locator('.row-state')).toHaveText('Added');
      await expect(row(page, 'IMG_0412').locator('.row-reason')).toContainText('smaller copy');
      await expect(row(page, 'IMG_0415').locator('.row-state')).toHaveText('Already on your Mac');
      await expect(row(page, 'market').locator('.row-reason')).toHaveText('This video is too big for your Mac.');
      await expect(row(page, 'golden').locator('.row-meter')).toContainText('/s');
      await expect(row(page, 'chai').locator('.row-state')).toHaveText('Waiting');
      await expect(page.locator('#summary')).toHaveText(/^2 of 5 added · .+ to go$/);
      await check(page, testInfo, 'sending', `sending-${at}`);

      // The Mac stops answering: two missed checks and the page says so, with a way to try again.
      mac.mode = 'down';
      await expect(page.locator('#screen-lost')).toBeVisible({ timeout: 15_000 });
      await check(page, testInfo, 'lost', `lost-${at}`);

      // It answers, but its phone screen is closed: the page waits for it.
      mac.mode = 'closed';
      await page.locator('#lost-retry').click();
      await expect(page.locator('#screen-waiting')).toBeVisible();
      await check(page, testInfo, 'waiting', `waiting-${at}`);

      mac.mode = 'up';
      await page.locator('#waiting-check').click();
      await expect(page.locator('#screen-sending')).toBeVisible();

      // The Mac forgot this phone: connect again (the QR's token is still at hand, so it asks the computer to
      // allow it again), and the rows wait for it.
      mac.mode = 'expired';
      await expect(page.locator('#pair-title')).toHaveText('Connect again', { timeout: 15_000 });
      await expect(page.locator('#pair-lede')).toContainText('ran out');
      await expect(page.locator('#approval-code')).toHaveText(/^\d{2}$/);
      await check(page, testInfo, 'expired', `expired-${at}`);
      mac.approval.answer('allowed');
      await expect(page.locator('#screen-sending')).toBeVisible();
      await expect(row(page, 'golden').locator('.row-meter')).toContainText('%');

      expect(expected(problems, ['status of 401', 'status of 404', 'ERR_CONNECTION_REFUSED'])).toEqual([]);
      await close();
    });

    test(`${at}: what arrived and what didn't, with why`, async ({ browser }, testInfo) => {
      const { page, problems, close } = await openPhone(browser, device, { theme });
      await pairPhone(page);
      await pick(page, device, SETTLING);
      await expect(page.locator('#screen-done')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#done-title')).toHaveText('2 of 4 on your Mac');
      await expect(rows(page, '#done-arrived')).toHaveCount(2);
      await expect(row(page, 'scan-receipt', '#done-missing').locator('.row-state')).toHaveText('Refused by your Mac');
      await expect(row(page, 'scan-receipt', '#done-missing').locator('.row-reason')).toHaveText(
        'Your Mac only takes videos and photos.',
      );
      await expect(row(page, 'market', '#done-missing').locator('.row-reason')).toHaveText(
        'This video is too big for your Mac.',
      );
      await check(page, testInfo, 'done, some', `done-some-${at}`);

      await page.locator('#done-more').click();
      await expect(page.locator('#choose-strip-text')).toHaveText('2 of 4 on your Mac');
      await check(page, testInfo, 'choose more', `choose-again-${at}`);
      expect(problems).toEqual([]);
      await close();
    });
  }
}

test('412, light and dark: everything arrived', async ({ browser }, testInfo) => {
  for (const theme of ['light', 'dark'] as const) {
    const { page, close } = await openPhone(browser, GALAXY_S26, { theme });
    await pairPhone(page);
    await pick(page, GALAXY_S26, [
      { name: 'beach-sunset.mov', size: 1_500_000 },
      { name: 'IMG_0415.MOV', size: 1_800_000 },
    ]);
    await expect(page.locator('#done-title')).toHaveText('All on your Mac', { timeout: 20_000 });
    await expect(page.locator('#done-missing-group')).toBeHidden();
    await check(page, testInfo, 'done, all', `done-all-412-${theme}`);
    await close();
  }
});

test.describe('in Hindi', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`412, ${theme}: Devanagari in its own face, nothing clipped`, async ({ browser }, testInfo) => {
      const { page, problems, close } = await openPhone(browser, GALAXY_S26, { theme, locale: 'hi' });
      await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
      await expect(page.locator('#pin .digit').first()).toHaveAttribute('aria-label', /1/);
      await typePin(page, '11');
      await check(page, testInfo, 'connect (hi)', `pair-hi-412-${theme}`);
      expect(await clippedText(page)).toEqual([]);
      await typePin(page, '1111');
      await expect(page.locator('#pair-error')).toBeVisible();
      await check(page, testInfo, 'wrong PIN (hi)', `pair-wrong-hi-412-${theme}`);
      await pairPhone(page);
      await pick(page, GALAXY_S26, SENDING);
      await expect(row(page, 'golden').locator('.row-meter')).toContainText('प्रति सेकंड');
      expect(await clippedText(page)).toEqual([]);
      await check(page, testInfo, 'sending (hi)', `sending-hi-412-${theme}`);
      const faces = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replaceAll('"', ''));
      });
      expect(faces).toEqual(expect.arrayContaining(['Noto Sans Devanagari Variable', 'JetBrains Mono Variable']));
      expect(expected(problems, ['status of 401'])).toEqual([]);
      await close();
    });
  }
});

test.describe('pseudo-locale (en-XA)', () => {
  for (const device of DEVICES.filter((d) => d.width <= 375)) {
    test(`${device.name}: nothing clipped by code and PIN, while sending, or when done`, async ({ browser }) => {
      const { page, problems, close } = await openPhone(browser, device, { theme: 'light', locale: 'en-XA', token: false });
      await expect(page.locator('#code-field')).toBeVisible();
      await expect(page.locator('#pair-submit-label')).toHaveText('[» Connect «]');
      await page.locator('#code').fill('7KD2 M9QX');
      await expectPhoneFit(page, 'connect (en-XA)');
      expect(await clippedText(page), 'connect: text that does not fit').toEqual([]);
      await shot(page, `pair-xa-${device.name}`);

      await pairPhone(page);
      await pick(page, device, SENDING);
      await expect(row(page, 'market').locator('.row-reason')).toContainText('[»');
      await expect(row(page, 'golden').locator('.row-meter')).toContainText('/s');
      await settle(page);
      await expectPhoneFit(page, 'sending (en-XA)');
      expect(await clippedText(page), 'sending: text that does not fit').toEqual([]);
      await shot(page, `sending-xa-${device.name}`);
      expect(problems).toEqual([]);
      await close();
    });
  }

  test('375: done, with the reasons', async ({ browser }) => {
    const device = DEVICES[1] as Device;
    const { page, close } = await openPhone(browser, device, { theme: 'light', locale: 'en-XA' });
    await pairPhone(page);
    await pick(page, device, SETTLING);
    await expect(page.locator('#screen-done')).toBeVisible({ timeout: 20_000 });
    await settle(page);
    await expectPhoneFit(page, 'done (en-XA)');
    expect(await clippedText(page), 'done: text that does not fit').toEqual([]);
    await shot(page, `done-xa-${device.name}`);
    await close();
  });
});
