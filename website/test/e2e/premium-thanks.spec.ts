// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';
import { CONFIRM_BODY, PAID, RETURN, RETURN_QUERY, mockConfirm, thanks, unpaid } from './premium-helpers';

/**
 * /premium/thanks/: where the payment page sends a buyer back, with the billing service mocked. The page hands the
 * five values in its address to the service, takes them out of the address, and shows one state for what comes back:
 * paid, not seen yet, expired, cancelled, not matched, or out of reach; opened any other way, nothing to check.
 * Every state carries the address, and none shows anything personal.
 */

test.use({ timezoneId: 'Asia/Kolkata', locale: 'en-GB', reducedMotion: 'reduce' });

const state = (page: Page) => thanks(page).getAttribute('data-state');
const heading = (page: Page) => thanks(page).getByRole('heading', { level: 2 });
const address = (page: Page) => thanks(page).getByRole('link', { name: 'admin@matterwardlabs.com' });
const sent = (request: { postData(): string | null }) => JSON.parse(request.postData() ?? 'null') as unknown;

async function expectState(page: Page, kind: string, title: string) {
  await expect(thanks(page)).toHaveAttribute('data-state', kind, { timeout: 20_000 });
  await expect(heading(page)).toHaveText(title);
  // Every state carries the address.
  await expect(address(page)).toHaveAttribute('href', 'mailto:admin@matterwardlabs.com');
}

test('paid: what happens next, the day the plan is active by, and nothing personal', async ({ page }) => {
  // Even if the service sent a name by mistake, the page has nowhere to show it.
  const asked = await mockConfirm(page, { body: { ...PAID, name: 'Asha Rao', email: 'asha@example.com' } });
  await page.goto(`/premium/thanks/${RETURN_QUERY}`);
  await expectState(page, 'paid', 'Payment received.');
  expect(asked).toHaveLength(1);
  expect(asked[0]!.method()).toBe('POST');
  expect(new URL(asked[0]!.url()).pathname).toMatch(/\/v1\/orders\/confirm$/);
  expect(sent(asked[0]!)).toEqual(CONFIRM_BODY);
  const panel = thanks(page);
  await expect(panel).toContainText('We have your payment of $339 for Taalcut Premium.');
  await expect(panel).toContainText(
    'Within one business day we write to you, by email or WhatsApp, to book your setup session.',
  );
  await expect(panel).toContainText(
    'In one session by screen share, we install Taalcut on your Mac and set it up with you.',
  );
  // The day is the billing service's own (its email says the same date): 26 November, wherever the visitor is.
  await expect(panel).toContainText(
    'Your plan is active by 26 November 2026, and your paid month starts on the day it is.',
  );
  await expect(panel).toContainText('If it isn’t active by then, we refund you in full.');
  await expect(panel).toContainText(`Your order reference: ${PAID.orderId}`);
  // The messages a buyer gets, exactly: the provider's receipt, and one email from the billing service's sender.
  await expect(panel).toContainText(
    'You get two emails: our payment provider’s receipt, and one from Taalcut (premium@taalcut.app) saying your payment is in and what happens next.',
  );
  // The sender is named, never offered as somewhere to write: the one link is the address.
  await expect(panel.locator('a[href^="mailto:"]')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText(/Asha|asha@example\.com/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your Premium order');
  // The payment's values are out of the address, and of the history entry, at once.
  expect(page.url()).toMatch(/\/premium\/thanks\/$/);
  expect(await page.evaluate(() => window.location.search)).toBe('');
  // The page shows the order's reference and nothing else of what came back with the payment.
  const shown = await page.content();
  for (const hidden of [
    RETURN.razorpay_payment_id,
    RETURN.razorpay_payment_link_id,
    RETURN.razorpay_signature,
    'razorpay',
  ]) {
    expect(shown, hidden).not.toContain(hidden);
  }
});

test('paid, then reloaded: the paid state is still there, from the tab’s own record, and nothing is asked again', async ({
  page,
  context,
}) => {
  const asked = await mockConfirm(page);
  await page.goto(`/premium/thanks/${RETURN_QUERY}`);
  await expectState(page, 'paid', 'Payment received.');
  await page.reload();
  await expectState(page, 'paid', 'Payment received.');
  await expect(thanks(page)).toContainText('We have your payment of $339 for Taalcut Premium.');
  await expect(thanks(page)).toContainText('Your plan is active by 26 November 2026');
  await expect(thanks(page)).toContainText(`Your order reference: ${PAID.orderId}`);
  expect(asked).toHaveLength(1);
  expect(await page.evaluate(() => window.location.search)).toBe('');
  // What the tab keeps is the billing service's answer for the order: nothing personal, none of the payment's values.
  const kept = await page.evaluate(() => ({
    session: Object.fromEntries(Object.entries(window.sessionStorage)),
    local: Object.keys(window.localStorage),
  }));
  // Beside the logo's own once-a-session mark, the one thing the tab keeps is the order's outcome.
  expect(Object.keys(kept.session).filter((key) => key !== 'taalcut.countedIn')).toEqual([
    'taalcut.premiumOrder',
  ]);
  expect(JSON.parse(kept.session['taalcut.premiumOrder']!)).toEqual(PAID);
  expect(kept.local.filter((key) => /premium|order/i.test(key))).toEqual([]);
  for (const hidden of [
    RETURN.razorpay_payment_id,
    RETURN.razorpay_payment_link_id,
    RETURN.razorpay_signature,
  ]) {
    expect(JSON.stringify(kept), hidden).not.toContain(hidden);
  }
  // Another tab has no record: there, nothing to check.
  const other = await context.newPage();
  const again = await mockConfirm(other);
  await other.goto('/premium/thanks/');
  await expect(thanks(other)).toHaveAttribute('data-state', 'missing');
  expect(again).toHaveLength(0);
  await other.close();
});

test('only a confirmed payment is kept: an expired one, reloaded, has nothing to show', async ({ page }) => {
  await mockConfirm(page, { body: unpaid('expired') });
  await page.goto(`/premium/thanks/${RETURN_QUERY}`);
  await expectState(page, 'expired', 'This payment link expired.');
  expect(await page.evaluate(() => window.sessionStorage.getItem('taalcut.premiumOrder'))).toBeNull();
  await page.reload();
  await expectState(page, 'missing', 'Nothing to check here.');
});

test('a record written by hand is not shown as a payment', async ({ page }) => {
  await mockConfirm(page);
  await page.addInitScript(() => {
    window.sessionStorage.setItem('taalcut.premiumOrder', '{"status":"paid","amount":"free"}');
  });
  await page.goto('/premium/thanks/');
  await expectState(page, 'missing', 'Nothing to check here.');
});

test('pending: asked again a few times, then it says a payment can take a minute and offers Check again', async ({
  page,
}) => {
  const asked = await mockConfirm(page, (_request, nth) => ({ body: nth <= 4 ? unpaid('pending') : PAID }));
  await page.goto(`/premium/thanks/${RETURN_QUERY}`);
  expect(await state(page)).toBe('checking');
  await expectState(page, 'pending', 'We don’t see your payment yet.');
  expect(asked).toHaveLength(4);
  await expect(thanks(page)).toContainText(
    'It can take a minute to reach us. The receipt our payment provider emails you is proof of payment.',
  );
  await thanks(page).getByRole('button', { name: 'Check again' }).click();
  await expectState(page, 'paid', 'Payment received.');
  expect(asked).toHaveLength(5);
  // The same five values each time: they were kept in memory, not in the address.
  for (const request of asked) expect(sent(request)).toEqual(CONFIRM_BODY);
});

test('pending at first, paid a moment later: the page finds out by itself', async ({ page }) => {
  const asked = await mockConfirm(page, (_request, nth) => ({ body: nth === 1 ? unpaid('pending') : PAID }));
  await page.goto(`/premium/thanks/${RETURN_QUERY}`);
  await expectState(page, 'paid', 'Payment received.');
  expect(asked).toHaveLength(2);
});

for (const [kind, title] of [
  ['expired', 'This payment link expired.'],
  ['cancelled', 'This payment was cancelled.'],
] as const) {
  test(`${kind}: nothing was charged, and the way back to Premium`, async ({ page }) => {
    const asked = await mockConfirm(page, { body: unpaid(kind) });
    await page.goto(`/premium/thanks/${RETURN_QUERY}`);
    await expectState(page, kind, title);
    await expect(thanks(page)).toContainText('Nothing was charged. You can order again.');
    await expect(thanks(page).getByRole('link', { name: 'Back to Premium' })).toHaveAttribute(
      'href',
      '/premium/',
    );
    await expect(thanks(page).getByRole('button', { name: 'Check again' })).toHaveCount(0);
    expect(asked).toHaveLength(1);
  });
}

for (const [name, query] of [
  ['no values at all', ''],
  ['one value short', `?${new URLSearchParams(Object.entries(RETURN).slice(1)).toString()}`],
  ['an empty value', `?${new URLSearchParams({ ...RETURN, razorpay_signature: '' }).toString()}`],
  ['some other query', '?ref=producthunt'],
] as const) {
  test(`values missing (${name}): nothing to check, nothing asked, and the address is clean`, async ({
    page,
  }) => {
    const asked = await mockConfirm(page);
    await page.goto(`/premium/thanks/${query}`);
    await expectState(page, 'missing', 'Nothing to check here.');
    await expect(thanks(page)).toContainText(
      'If you paid, the receipt our payment provider emailed you is proof of payment.',
    );
    await expect(thanks(page).getByRole('link', { name: 'Back to Premium' })).toHaveAttribute(
      'href',
      '/premium/',
    );
    expect(asked).toHaveLength(0);
    expect(await page.evaluate(() => window.location.search)).toBe('');
  });
}

for (const [name, reply] of [
  [
    'a signature that doesn’t match',
    { status: 400, body: { code: 'billing.invalid', problems: [{ path: 'signature', rule: 'signature' }] } },
  ],
  ['an order it doesn’t know', { status: 404, body: { code: 'billing.not_found' } }],
] as const) {
  test(`values refused (${name}): the receipt is the proof, and no Check again`, async ({ page }) => {
    const asked = await mockConfirm(page, reply);
    await page.goto(`/premium/thanks/${RETURN_QUERY}`);
    await expectState(page, 'refused', 'We couldn’t match these payment details.');
    await expect(thanks(page)).toContainText(
      'If you paid, the receipt our payment provider emailed you is proof of payment. Send it to us and we sort it out.',
    );
    await expect(thanks(page).getByRole('button')).toHaveCount(0);
    expect(asked).toHaveLength(1);
  });
}

for (const [name, reply] of [
  ['out of reach', null],
  ['a fault of ours', { status: 500, body: { code: 'billing.busy' } }],
  ['the payment provider not answering', { status: 502, body: { code: 'billing.provider_unavailable' } }],
  ['too many tries', { status: 429, body: { code: 'billing.rate_limited', retryAfterSeconds: 18000 } }],
  ['a page it refuses', { status: 403, body: { code: 'billing.forbidden' } }],
  ['an answer of the wrong shape', { status: 200, body: { ...PAID, status: 'refunded' } }],
  [
    'an answer about another order',
    { status: 200, body: { ...PAID, orderId: '01KA7Q3ZV5R8N2M4X6C9D1E3F6' } },
  ],
] as const) {
  test(`billing service unreachable (${name}): the payment isn’t affected, and Check again asks once more`, async ({
    page,
  }) => {
    const asked = await mockConfirm(page, (_request, nth) => (nth === 1 ? reply : { body: PAID }));
    await page.goto(`/premium/thanks/${RETURN_QUERY}`);
    await expectState(page, 'unreachable', 'We couldn’t reach our billing service.');
    // A wait can be hours, so the words promise no short one.
    await expect(thanks(page)).toContainText(
      'Your payment isn’t affected. Check again later, or write to us.',
    );
    expect(asked).toHaveLength(1);
    await thanks(page).getByRole('button', { name: 'Check again' }).click();
    await expectState(page, 'paid', 'Payment received.');
    expect(asked).toHaveLength(2);
  });
}

test('each change of state is said: the panel is a polite live region', async ({ page }) => {
  await mockConfirm(page);
  await page.goto(`/premium/thanks/${RETURN_QUERY}`);
  await expectState(page, 'paid', 'Payment received.');
  await expect(thanks(page).getByRole('status')).toHaveAttribute('aria-live', 'polite');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the page says the check needs it, with the address, and keeps one h1', async ({ page }) => {
    await page.goto('/premium/thanks/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your Premium order');
    // The line waits in a <noscript> (Playwright's no-JS mode still parses that as text, so read the served HTML).
    const html = await (await page.request.get('/premium/thanks/')).text();
    const still = html.match(/<noscript>(.*?)<\/noscript>/gs)?.join('') ?? '';
    expect(still).toContain(
      'This page needs JavaScript to check your payment. The receipt our payment provider emails you is proof of payment.',
    );
    expect(still).toContain('[role="status"]{display:none!important}');
    await expect(address(page)).toHaveAttribute('href', 'mailto:admin@matterwardlabs.com');
  });
});
