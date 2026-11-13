// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, test, type Page } from '@playwright/test';
import { settle } from './axe';
import { fakePhone, server } from './phone-flow-support';
import { preferences } from './support';

test.use({ viewport: { width: 960, height: 600 } });

async function expectWorkspaceFits(page: Page) {
  await settle(page);
  const overflow = await page.locator('[data-slot=wifi-workspace]').evaluate((workspace) => {
    const problems: string[] = [];
    let node: HTMLElement | null = workspace as HTMLElement;
    while (node) {
      const label = node.dataset.slot ?? node.tagName.toLowerCase();
      if (node.scrollHeight > node.clientHeight + 1) problems.push(`${label}: vertical overflow`);
      if (node.scrollWidth > node.clientWidth + 1) problems.push(`${label}: horizontal overflow`);
      node = node.parentElement;
    }
    const box = workspace.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight + 1) problems.push('workspace outside viewport');
    return problems;
  });
  expect(overflow, 'the complete Wi-Fi workspace fits without scrolling or clipping').toEqual([]);
  for (const href of ['/library/imports?phones=true', '/library/import/phone-wifi/help']) {
    await expect(page.locator(`a[href="${href}"]`).last()).toBeInViewport({ ratio: 1 });
  }
}

for (const variant of [
  { name: 'light', theme: 'light', locale: 'en' },
  { name: 'dark', theme: 'dark', locale: 'en' },
  { name: 'pseudo-dark', theme: 'dark', locale: 'en-XA' },
] as const) {
  test(`resting, pairing and manual connection fit the minimum window (${variant.name})`, async ({
    page,
  }) => {
    await preferences(page, variant);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fakePhone(page, { transfer: 'waiting' });
    await page.goto('/library/import/phone-wifi');
    const connect = page.locator('[data-action=wifi-connect]');
    await expect(connect).toBeInViewport({ ratio: 1 });
    await expectWorkspaceFits(page);
    expect(await server(page)).toMatchObject({ opens: 0, listening: false });
    await expect(page.locator('[data-slot=qr-code]')).toHaveCount(0);
    await connect.click();
    await expect(page.locator('[data-slot=qr-code]')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-slot=pin]')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-slot=pairing] figure').getByRole('button')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-slot=listening]').getByRole('button')).toBeInViewport({ ratio: 1 });
    await expectWorkspaceFits(page);
    await page.locator('[data-action=wifi-manual]').click();
    await expect(page.locator('[data-slot=wifi-manual]')).toBeInViewport({ ratio: 1 });
    await expectWorkspaceFits(page);
    await page.locator('[data-action=wifi-scan]').click();
    await expect(page.locator('[data-slot=pairing] ol > li')).toHaveCount(3);
    await expectWorkspaceFits(page);
    expect(await server(page)).toMatchObject({ opens: 1, listening: true });
  });
}

for (const scenario of ['connected', 'phone'] as const) {
  test(`${scenario === 'phone' ? 'receiving files' : 'a connected phone'} fits the minimum window`, async ({
    page,
  }) => {
    await preferences(page, { locale: 'en', theme: 'dark' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fakePhone(page, { transfer: scenario, transferSpeed: 1 });
    await page.goto('/library/import/phone-wifi');
    await page.locator('[data-action=wifi-connect]').click();
    await expect(page.locator('[data-slot=connection]')).toHaveAttribute('data-connection', 'connected');
    if (scenario === 'phone') {
      await expect.poll(async () => (await server(page)).session?.totals.files ?? 0).toBeGreaterThan(0);
    }
    await expectWorkspaceFits(page);
    await expect(page.getByRole('button', { name: 'Stop listening' })).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Stop listening' }).click();
    await expect.poll(async () => (await server(page)).listening).toBe(false);
    await expect(page.getByRole('img', { name: 'QR code to connect your phone' })).toHaveCount(0);
  });
}

test('cable workspace fits the minimum window when waiting and when a phone is plugged in', async ({
  page,
}) => {
  await preferences(page, { locale: 'en', theme: 'dark' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fakePhone(page, { usb: 'iphone' });
  await page.goto('/library/import/phone-cable');
  const connect = page.locator('[data-action=import-connect]');
  await expect(connect).toBeInViewport({ ratio: 1 });
  await expect(page.locator('[data-action=open-device]')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('a[href="/library/import/phone-cable/help"]').last()).toBeInViewport({ ratio: 1 });
  await settle(page);
  const overflow = await page.locator('[data-slot=cable-workspace]').evaluate((workspace) => {
    const problems: string[] = [];
    let node: HTMLElement | null = workspace as HTMLElement;
    while (node) {
      const label = node.dataset.slot ?? node.tagName.toLowerCase();
      if (node.scrollHeight > node.clientHeight + 1) problems.push(`${label}: vertical overflow`);
      if (node.scrollWidth > node.clientWidth + 1) problems.push(`${label}: horizontal overflow`);
      node = node.parentElement;
    }
    const box = workspace.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight + 1) problems.push('workspace outside viewport');
    return problems;
  });
  expect(overflow, 'the complete USB cable workspace fits without scrolling or clipping').toEqual([]);
  expect(await server(page)).toMatchObject({ opens: 0, listening: false });
});
