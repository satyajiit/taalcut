// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3 (phn): a phone that scanned the QR asks the computer to let it in, and a person there allows or denies it.
// The page asks at once, shows the two digits the computer shows while it waits, and goes on to Choose once
// allowed. Every other ending (said no, no answer, another phone asking, a QR that changed, too many tries, a
// request that lapsed while the page was hidden) has its sentence where the waiting line was, with Ask again
// where asking again can help; "Use the PIN instead" withdraws the request. Axe on the waiting and said-no states
// in both themes, photographed on the iPhone 15 and Pixel 8 profiles. The page and its stand-in computer are
// phone-page-support.ts's and phone-page-approval-support.ts's.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { ALLOWED } from './phone-page-approval-support.ts';
import {
  expectPhoneFit,
  GALAXY_S26 as PHONE,
  GOOD_PIN,
  openPhone,
  pairPhone,
  profile,
  QR_TOKEN,
  SETUP_CODE,
  typePin,
  view,
} from './phone-page-support.ts';

test.describe.configure({ timeout: 120_000 });

const WAITING = 'Waiting for approval on your computer…';
const text = (page: Page) => page.locator('#approval-text');
const line = (page: Page) => page.locator('#approval-line');
const again = (page: Page) => page.getByRole('button', { name: 'Ask again' });
/** The browser logs each refused request; these are the ones a test asked for. */
const unexpected = (problems: string[], statuses: number[]) =>
  problems.filter((problem) => !statuses.some((status) => problem.includes(`status of ${status}`)));

async function waiting(page: Page, code = '47'): Promise<void> {
  await expect(page.locator('#approval-code')).toHaveText(code);
  await expect(text(page)).toHaveText(WAITING);
  await expect(line(page)).toHaveAttribute('data-state', 'waiting');
  await expect(page.locator('#approval-match')).not.toHaveAttribute('data-stale', /.*/);
}

async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('the QR link asks at once and shows the match code; once allowed, the Connected moment, then Choose', async ({
  browser,
}) => {
  const { page, mac, problems, close } = await openPhone(browser, PHONE, { theme: 'light', approve: true });
  await expect(page.locator('#pair-form')).toBeHidden();
  await expect(page.locator('#pair-help')).toBeHidden();
  await expect(page.locator('#pair-title')).toHaveText('Connect to your Mac');
  await expect(page.locator('#pair-lede')).toHaveText(
    'On your computer, choose Allow to let this phone send videos.',
  );
  await waiting(page);
  await expect(page.locator('#approval-match')).toContainText('Your computer shows the same number');
  await expect(line(page)).toHaveAttribute('role', 'status');
  await expect(again(page)).toBeHidden();
  expect(await page.locator('#approval-code').evaluate((code) => getComputedStyle(code).fontFamily)).toMatch(
    /^"JetBrains Mono Variable"/,
  );
  expect(mac.approval.asks).toEqual([{ token: QR_TOKEN, device: { name: 'SM-S948B' } }]);

  // It keeps asking whether anyone answered; a person allows it, and the line says so before the page moves on.
  await expect.poll(() => mac.approval.polls).toBeGreaterThanOrEqual(3);
  mac.approval.answer('allowed');
  await page.waitForFunction(
    () =>
      document.getElementById('approval-line')?.dataset.state === 'allowed' &&
      document.getElementById('approval-text')?.textContent === 'Connected',
    null,
    { polling: 'raf' },
  );
  await expect(page.locator('#screen-choose')).toBeVisible();
  const polls = mac.approval.polls;
  await page.waitForTimeout(1_000);
  expect(mac.approval.polls, 'no polls once answered').toBe(polls);
  expect(mac.pairs, 'no PIN was needed').toBe(0);
  expect(mac.approval.cancelled).toEqual([]);
  const session = await page.evaluate(() => sessionStorage.getItem('taalcut.transfer'));
  expect(JSON.parse(session ?? '{}')).toEqual(ALLOWED);
  expect(problems).toEqual([]);
  await close();
});

test('said no: the sentence and Ask again, the code dimmed; asked again, a new code, allowed after a few polls', async ({
  browser,
}) => {
  const { page, mac, problems, close } = await openPhone(browser, PHONE, {
    theme: 'light',
    approve: true,
    prepare: (fake) =>
      fake.approval.plans.push({ verdict: 'denied', after: 2 }, { verdict: 'allowed', after: 4 }),
  });
  await expect(text(page)).toHaveText('Your computer said no.');
  await expect(line(page)).toHaveAttribute('data-state', 'failed');
  await expect(page.locator('#approval-code')).toHaveText('47');
  await expect(page.locator('#approval-match')).toHaveAttribute('data-stale', '');
  await expect(again(page)).toBeEnabled();
  expect(mac.approval.requests[0]?.polls).toBe(3);

  await again(page).click();
  // Ask again goes while the computer is asked; the focus it held lands on the heading.
  await expect(page.locator('#pair-title')).toBeFocused();
  await waiting(page, '81');
  await expect(page.locator('#screen-choose')).toBeVisible();
  expect(mac.approval.asks).toHaveLength(2);
  expect(mac.approval.requests[1]?.polls).toBe(5);
  expect(mac.approval.cancelled, 'an answered request is spent, not withdrawn').toEqual([]);
  expect(problems).toEqual([]);
  await close();
});

test('no answer from the computer: its sentence and Ask again', async ({ browser }) => {
  const { page, problems, close } = await openPhone(browser, PHONE, {
    theme: 'light',
    approve: true,
    prepare: (fake) => fake.approval.plans.push({ verdict: 'expired', after: 1 }),
  });
  await expect(text(page)).toHaveText('No answer from your computer.');
  await expect(again(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use the PIN instead' })).toBeVisible();
  expect(problems).toEqual([]);
  await close();
});

test('another phone is asking: wait a moment, then Ask again opens a request', async ({ browser }) => {
  const { page, mac, problems, close } = await openPhone(browser, PHONE, {
    theme: 'light',
    approve: true,
    prepare: (fake) => fake.approval.replies.push(409),
  });
  await expect(text(page)).toHaveText(
    'Another phone is asking your computer right now. Wait a moment, then ask again.',
  );
  await expect(page.locator('#approval-match'), 'no request, no code').toBeHidden();
  await again(page).click();
  await waiting(page);
  expect(mac.approval.asks).toHaveLength(2);
  expect(unexpected(problems, [409])).toEqual([]);
  await close();
});

test('too many tries: Ask again waits for Retry-After', async ({ browser }) => {
  const { page, problems, close } = await openPhone(browser, PHONE, {
    theme: 'light',
    approve: true,
    prepare: (fake) => fake.approval.replies.push(429),
  });
  await expect(text(page)).toHaveText('Too many tries. Wait a moment, then try again.');
  await expect(again(page)).toBeDisabled();
  await expect(again(page)).toBeEnabled({ timeout: 3_000 });
  await again(page).click();
  await waiting(page);
  expect(unexpected(problems, [429])).toEqual([]);
  await close();
});

test('a QR that changed (401): scan the new one, or the setup code and PIN, which pair', async ({
  browser,
}) => {
  const { page, mac, problems, close } = await openPhone(browser, PHONE, {
    theme: 'light',
    approve: true,
    prepare: (fake) => fake.approval.replies.push(401),
  });
  await expect(page.locator('#pair-error-text')).toHaveText(
    'This QR code no longer works. Scan the new one on your computer, or type the setup code and PIN it shows.',
  );
  await expect(page.locator('#approval')).toBeHidden();
  await expect(page.locator('#code-field')).toBeVisible();
  await expect(page.locator('#pair-lede')).toHaveText('Type the setup code and the PIN shown on your Mac.');
  await expect(page.locator('#code')).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem('taalcut.transfer.token'))).toBeNull();
  await page.locator('#code').fill('7KD2 M9QX');
  await pairPhone(page);
  expect(mac.code).toBe(SETUP_CODE);
  expect(unexpected(problems, [401])).toEqual([]);
  await close();
});

test('Use the PIN instead withdraws the request, and the PIN pairs with the QR’s token', async ({
  browser,
}) => {
  const { page, mac, problems, close } = await openPhone(browser, PHONE, { theme: 'light', approve: true });
  await waiting(page);
  await page.getByRole('button', { name: 'Use the PIN instead' }).click();
  await expect(page.locator('#pair-form')).toBeVisible();
  await expect(page.locator('#approval')).toBeHidden();
  await expect(page.locator('#code-field')).toBeHidden();
  await expect(page.locator('#pair-lede')).toHaveText('Type the PIN shown next to the QR code on your Mac.');
  await expect(page.getByRole('textbox', { name: 'Digit 1 of 6' })).toBeFocused();
  await expect.poll(() => mac.approval.cancelled).toEqual([mac.approval.requests[0]?.ticket]);
  const polls = mac.approval.polls;
  await typePin(page, GOOD_PIN);
  await expect(page.locator('#screen-choose')).toBeVisible();
  expect(mac.pairs).toBe(1);
  expect(mac.approval.polls, 'no polls after the PIN took over').toBe(polls);
  expect(problems).toEqual([]);
  await close();
});

test('hidden, the page stops asking; seen again after its request lapsed, it says so and offers Ask again', async ({
  browser,
}) => {
  const { page, mac, problems, close } = await openPhone(browser, PHONE, { theme: 'light', approve: true });
  await waiting(page);
  await setVisibility(page, 'hidden');
  await page.waitForTimeout(400);
  const polls = mac.approval.polls;
  await page.waitForTimeout(1_200);
  expect(mac.approval.polls, 'no polls while hidden').toBe(polls);
  mac.approval.lapse();
  await setVisibility(page, 'visible');
  await expect(text(page)).toHaveText('No answer from your computer.');
  expect(mac.approval.polls).toBe(polls + 1);
  await again(page).click();
  await waiting(page, '81');
  expect(unexpected(problems, [404])).toEqual([]);
  await close();
});

for (const device of [profile('iPhone 15'), profile('Pixel 8')]) {
  test(`${device.name}: waiting and said no, light and dark: they fit, pass axe and are photographed`, async ({
    browser,
  }, testInfo) => {
    for (const theme of ['light', 'dark'] as const) {
      const { page, mac, problems, close } = await openPhone(browser, device, { theme, approve: true });
      await waiting(page);
      await expectPhoneFit(page, `waiting, ${theme}`);
      await expectAccessible(page, testInfo, `waiting, ${theme}`);
      await view(page, `${device.name}-approval-waiting-${theme}`);
      mac.approval.answer('denied');
      await expect(text(page)).toHaveText('Your computer said no.');
      await expectPhoneFit(page, `said no, ${theme}`);
      await expectAccessible(page, testInfo, `said no, ${theme}`);
      await view(page, `${device.name}-approval-denied-${theme}`);
      expect(problems).toEqual([]);
      await close();
    }
  });
}
