// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-PHN: a phone that scanned the QR asks to pair, and only the person's Allow on the computer lets it in (the
// fake's 'approval' scenario, src/backend/fake/fake-transfer-approval.ts). Allow: the phone connects and sends;
// Deny, or Escape: nothing connects; no answer: the dialog goes by itself and the connection line says why; the
// dialog over another tab of the flow and on first run's sources step; axe in light and dark, the pseudo-locale.
// Screenshots of the dialog go to TAALCUT_PHN_SCREENS (else e2e-artifacts/screenshots/phn/).
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { clippedText, englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { openScreen } from './onboarding-shell-support.ts';
import { band, fakePhone, onTab, server, openPhone, followReception } from './phone-flow-support.ts';
import { ARTIFACTS, preferences } from './support.ts';

const SHOTS = process.env.TAALCUT_PHN_SCREENS ?? new URL('screenshots/phn/', ARTIFACTS).pathname;
const QUESTION = 'Allow iPhone to send videos?';

/** The fake server's request, and the phones it lets in (state() in src/backend/fake/fake-transfer.ts). */
const request = async (page: Page) => (await server(page)).approval;
const devices = async (page: Page) => (await server(page)).session?.devices ?? [];

/** The dialog, found by its slot so it is found in every language. */
const asking = (page: Page) => page.locator('[data-slot=approval-dialog]');

/** Opens the flow's Wi-Fi tab with the phone that asks; `options` adds to the fake's. */
async function phoneAsks(page: Page, options: Record<string, unknown> = {}): Promise<void> {
  await fakePhone(page, { transfer: 'approval', transferSpeed: 4, ...options });
  await openPhone(page);
  await expect(asking(page)).toBeVisible({ timeout: 10_000 });
}

test.describe('a phone asks to pair', () => {
  test('the question, the number, the address; Deny has the focus; Allow lets it in and it sends', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await phoneAsks(page);
    const dialog = page.getByRole('dialog', { name: QUESTION });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('A phone on your network opened this computer’s QR code.');
    const code = dialog.locator('[data-slot=match-code]');
    await expect(code).toHaveText('47');
    await expect(code).toHaveCSS('font-family', /JetBrains Mono/);
    await expect(dialog).toContainText('The phone’s address: 192.168.1.31');
    // An accidental Return never lets a phone in.
    await expect(dialog.getByRole('button', { name: 'Deny' })).toBeFocused();
    expect(await request(page)).toMatchObject({ state: 'pending' });
    expect(await devices(page)).toEqual([]);

    await dialog.getByRole('button', { name: 'Allow' }).click();
    await expect(dialog).toBeHidden();
    const line = page.locator('[data-slot=connection]');
    await expect(line).toHaveAttribute('data-connection', 'connected');
    await expect(line).toContainText('Connected to iPhone');
    expect(await request(page)).toMatchObject({ state: 'allowed' });
    await followReception(page);
    await onTab(page, 'transfers');
    await expect(page.locator('[data-slot=transfer-file]').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open' }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Deny: the dialog goes and nothing connects', async ({ page }) => {
    await phoneAsks(page);
    await asking(page).getByRole('button', { name: 'Deny' }).click();
    await expect(asking(page)).toBeHidden();
    await expect.poll(async () => (await request(page))?.state).toBe('denied');
    // The scripted phone would have paired by now had it been let in.
    await page.waitForTimeout(1500);
    expect(await devices(page)).toEqual([]);
    await expect(page.locator('[data-slot=connection]')).toHaveAttribute('data-connection', 'waiting');
  });

  test('Escape is Deny', async ({ page }) => {
    await phoneAsks(page);
    await page.keyboard.press('Escape');
    await expect(asking(page)).toBeHidden();
    await expect.poll(async () => (await request(page))?.state).toBe('denied');
    expect(await devices(page)).toEqual([]);
  });

  test('no answer: the dialog goes by itself, the line says why, nothing connects', async ({ page }) => {
    await phoneAsks(page, { transferApprovalMs: 2000 });
    await expect(asking(page)).toBeHidden({ timeout: 6000 });
    await expect(page.locator('[data-slot=approval-lapsed]')).toHaveText(
      'The request from iPhone ran out of time.',
    );
    expect(await request(page)).toMatchObject({ state: 'expired' });
    expect(await devices(page)).toEqual([]);
    await expect(band(page)).toContainText('listening on Wi-Fi');
  });

  test('over another tab of the flow: asked on Transfers, allowed there', async ({ page }) => {
    // Slow enough to be on Transfers before the phone asks.
    await fakePhone(page, { transfer: 'approval', transferSpeed: 0.5 });
    await openPhone(page);
    await followReception(page);
    await onTab(page, 'transfers');
    expect(await request(page)).toBeNull();
    const dialog = page.getByRole('dialog', { name: QUESTION });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await onTab(page, 'transfers');
    await dialog.getByRole('button', { name: 'Allow' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-slot=transfer-file]').first()).toBeVisible({ timeout: 15_000 });
  });

  test('on first run’s sources step, with Wi-Fi chosen', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakePhone(page, {
      onboarding: 'fresh',
      channel: 'alpha',
      library: 'empty',
      downloadTickMs: 0,
      system: 'mac',
      transfer: 'approval',
      transferSpeed: 4,
    });
    await openScreen(page, 'sources');
    await page.locator('li[data-way="wifi"] > button').click();
    await page.locator('[data-action=wifi-connect]').click();
    const dialog = page.getByRole('dialog', { name: QUESTION });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole('button', { name: 'Deny' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Allow' }).click();
    await expect(dialog).toBeHidden();
    const panel = page.locator('[role=region][data-way-panel="wifi"]');
    await expect(panel.locator('[data-slot=connection]')).toHaveAttribute('data-connection', 'connected');
    // The first file landing turns Continue on, as with a phone that typed the PIN.
    await expect(page.locator('[data-action="continue"]')).toBeEnabled({ timeout: 15_000 });
  });
});

for (const theme of ['light', 'dark'] as const)
  test(`the dialog in ${theme}: axe, and its screenshot`, async ({ page }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    await phoneAsks(page);
    // Let the dialog's entrance settle before it is scanned and shot.
    await page.waitForTimeout(400);
    await expectAccessible(page, testInfo, `approval dialog (${theme})`);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: `${SHOTS.replace(/\/?$/, '/')}approval-dialog-${theme}.png`,
      animations: 'disabled',
    });
  });

test.describe('the dialog in the pseudo-locale', () => {
  // The minimum the window is likely to be: long translations have the least room.
  test.use({ viewport: { width: 1024, height: 720 } });

  test('everything translated, nothing clipped', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await phoneAsks(page);
    await page.waitForTimeout(400);
    const text = await userFacingText(page, '[data-slot=approval-dialog]');
    expect(text.length).toBeGreaterThan(0);
    expect(englishShowing(text, englishPhrases()), 'English source strings on screen').toEqual([]);
    expect(untranslated(text), 'strings that skipped the catalogue').toEqual([]);
    expect(await clippedText(page, '[data-slot=approval-dialog] *'), 'text that does not fit').toEqual([]);
  });
});
