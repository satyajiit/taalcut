// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The phone flow (P2-L3, P2-L11, P3-B4, UX1): /library/phone and its four tabs, each a route. The index lands on a
// tab; the Mac listens on Wi-Fi only once the Wi-Fi tab shows and only while the flow is open; the QR, the PIN and
// the steps; bones while the session starts; a phone that sends, one that stops part-way; every failure with its
// fix; the cable's beats; Transfers and Help. Axe, the keyboard and the languages are in phone-flow-a11y.spec.ts.
import { expect, test } from '@playwright/test';
import {
  band,
  FLOW,
  fakePhone,
  onTab,
  server,
  tab,
  openPhone,
  followReception,
  openHelp,
} from './phone-flow-support.ts';
import { open } from './support.ts';

test.describe('the routed phone import', () => {
  test('old links redirect without starting reception', async ({ page }) => {
    await fakePhone(page, { transfer: 'waiting' });
    await open(page, FLOW);
    await onTab(page, 'wifi');
    expect((await server(page)).opens).toBe(0);
    for (const name of ['cable', 'transfers', 'help', 'wifi'] as const) {
      await open(page, tab(name));
      await onTab(page, name);
      expect((await server(page)).opens).toBe(0);
    }
  });
  test('explicit reception survives Library navigation until stopped', async ({ page }) => {
    await fakePhone(page, { transfer: 'waiting' });
    await openPhone(page);
    await expect.poll(async () => (await server(page)).listening).toBe(true);
    await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Library' }).click();
    expect((await server(page)).listening).toBe(true);
    await page
      .getByRole('navigation', { name: 'Library views' })
      .getByRole('link', { name: 'Imports' })
      .click();
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await expect.poll(async () => (await server(page)).listening).toBe(false);
  });
  test('Stop takes away the code; Start again opens a fresh connection', async ({ page }) => {
    await fakePhone(page, { transfer: 'waiting' });
    await openPhone(page);
    await expect(page.getByRole('img', { name: 'QR code to connect your phone' })).toBeVisible();
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await expect(page.getByRole('img', { name: 'QR code to connect your phone' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Start again' }).click();
    await expect.poll(async () => (await server(page)).listening).toBe(true);
    expect((await server(page)).opens).toBe(2);
  });
});

test.describe('the Wi-Fi tab', () => {
  test('the QR beside the steps, the PIN large and copyable, the plain-HTTP note', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await fakePhone(page, { transfer: 'waiting' });
    await openPhone(page);
    const qr = page.getByRole('img', { name: 'QR code to connect your phone' });
    const steps = page.locator('[data-slot=pairing] ol > li');
    await expect(steps).toHaveCount(3);
    // The QR is the hero: left of the steps, at the default window and the minimum one.
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      const [code, first] = await Promise.all([qr.boundingBox(), steps.first().boundingBox()]);
      expect(code && first && code.x + code.width <= first.x).toBe(true);
      await expect(page.locator('[data-slot=pin]')).toBeInViewport();
    }
    await expect(steps.first()).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('[data-slot=pin]')).toHaveCSS('font-family', /JetBrains Mono/);
    await page.getByRole('button', { name: 'Copy PIN' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('730254');
    await expect(page.getByText(/without encryption, so use this on a network you trust/)).toBeVisible();
    await expect(page.getByText(/On public Wi-Fi, bring them in with a cable instead/)).toBeVisible();
  });

  test('while the session starts: bones in the band’s and the hero’s shape, then the code', async ({
    page,
  }) => {
    await fakePhone(page, { transfer: 'waiting', transferStartMs: 1500 });
    await page.goto(tab('wifi').path);
    await page.locator('[data-action=wifi-connect]').click();
    for (const name of ['phone-status', 'phone-pairing']) {
      const skeleton = page.locator(`[data-boneyard=${name}]`);
      await expect(skeleton).toHaveAttribute('aria-busy', 'true');
      await expect(skeleton.locator('.tc-bone').first()).toBeVisible();
    }
    await expect(page.getByRole('status').filter({ hasText: 'Getting a code and PIN…' })).toBeAttached();
    await expect(page.getByRole('img', { name: 'QR code to connect your phone' })).toBeVisible();
    await expect(page.locator('[data-boneyard][aria-busy=true]')).toHaveCount(0);
  });

  test('a phone connects and sends: the line says so, Transfers shows each file, then Open', async ({
    page,
  }) => {
    await fakePhone(page, { transfer: 'phone', transferSpeed: 4 });
    await openPhone(page);
    const line = page.locator('[data-slot=connection]');
    await expect(line).toHaveAttribute('data-connection', 'connected');
    await expect(line).toContainText('Connected to iPhone');
    await expect(page.locator('[data-slot=pairing] ol > li').nth(1)).toHaveAttribute('data-step', 'done');
    await followReception(page);
    const files = page.locator('[data-slot=transfer-file]');
    await expect(files.first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(files).toHaveCount(4);
  });

  test('a phone that stops part-way: said, with what brings its clips back', async ({ page }) => {
    await fakePhone(page, { transfer: 'lost', transferSpeed: 4 });
    await openPhone(page);
    const line = page.locator('[data-slot=connection]');
    await expect(line).toHaveAttribute('data-connection', 'lost', { timeout: 10_000 });
    await expect(line).toContainText('stopped sending');
    await expect(line).toContainText('carry on by themselves');
  });

  test('five wrong PINs: a new code, said as a warning', async ({ page }) => {
    await fakePhone(page, { transfer: 'reset', transferSpeed: 4 });
    await openPhone(page);
    await expect(page.getByText(/typed a wrong PIN five times/)).toBeVisible();
  });

  test('a VPN that may block the phone is a warning line, and Help flags it', async ({ page }) => {
    await fakePhone(page, { transfer: 'blocked' });
    await openPhone(page);
    await expect(page.getByText(/A VPN or security app may stop your phone/)).toBeVisible();
    await openHelp(page);
    await expect(page.locator('[data-flagged]')).toContainText('This may be it');
  });
});

test.describe('every failure says its fix', () => {
  const cases = [
    { scenario: 'error', title: 'Taalcut couldn’t start listening', action: 'Try again' },
    { scenario: 'dropped', title: 'Taalcut stopped listening', action: 'Try again' },
    { scenario: 'bind-failed', title: 'Quit apps that share files over the network', action: 'Try again' },
    { scenario: 'no-network', title: 'Join the same Wi-Fi as your phone', action: 'Try again' },
    { scenario: 'originals-offline', title: 'Connect it, then start again.', action: 'Start again' },
  ] as const;
  for (const { scenario, title, action } of cases) {
    test(`${scenario}: the cause, the fix, and ${action}`, async ({ page }) => {
      await fakePhone(page, { transfer: scenario, transferSpeed: 4 });
      await openPhone(page);
      await expect(band(page)).toContainText(title, { timeout: 10_000 });
      await expect(page.getByRole('img', { name: 'QR code to connect your phone' })).toHaveCount(0);
      const opens = (await server(page)).opens;
      await band(page).getByRole('button', { name: action }).click();
      await expect.poll(async () => (await server(page)).opens).toBeGreaterThan(opens);
    });
  }

  test('no Wi-Fi: starts again by itself once this Mac is on a network', async ({ page }) => {
    test.slow();
    await fakePhone(page, { transfer: 'network-back' });
    await openPhone(page);
    await expect(band(page)).toContainText('This Mac isn’t on Wi-Fi');
    await expect(page.getByRole('img', { name: 'QR code to connect your phone' })).toBeVisible({
      timeout: 25_000,
    });
    await expect(band(page)).toContainText('Your Mac is listening on Wi-Fi at');
  });
});

test('cable connects explicitly and uses the shared selection and review', async ({ page }) => {
  await fakePhone(page, { usb: 'iphone' });
  await open(page, tab('cable'));
  expect((await server(page)).opens).toBe(0);
  await page.locator('[data-action=import-connect]').click();
  await page.locator('[data-item-index="0"]').click();
  await page.locator('[data-action=review-import]').click();
  await expect(page.locator('[data-action=start-import]')).toBeEnabled();
});

test('phone history has a useful empty state and Help retains pairing recovery', async ({ page }) => {
  await fakePhone(page, { transfer: 'waiting' });
  await open(page, tab('transfers'));
  await expect(page.getByRole('heading', { name: 'Your imports will appear here' })).toBeVisible();
  await open(page, tab('help'));
  await expect(page.getByRole('heading', { name: 'What phones remember' })).toBeVisible();
  await page.getByRole('button', { name: 'Forget paired phones' }).click();
  await expect(page.getByRole('status').filter({ hasText: /phones were paired|Forgot/ })).toBeVisible();
});
