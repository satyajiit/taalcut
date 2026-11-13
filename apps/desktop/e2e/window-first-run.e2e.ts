// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * First run in the real app (P2-X4): the test build with the real renderer on
 * a userData it has never opened, so the agent serves onboarding from an
 * empty library. The window opens on the welcome, not the chat; a step you
 * open is where the next launch resumes; Skip for now ends first run, and from
 * then on the app opens on the chat. Every other launch test starts with first
 * run done (launch.ts); this one leaves it as the app keeps it.
 *
 *   pnpm --filter @taalcut/desktop e2e:gate   (builds the renderer and the test build, then this)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchElectron } from './launch';
import { savedOnboarding } from './library-seed';
import { chatList, isNarrowWindow, SIDEBAR_TOGGLE } from './sidebar';

const WELCOME = 'Cut your clips to the beat of a reel you love.';
const SOURCES = 'Where are your videos?';

let userData: string;
let app: ElectronApplication | undefined;

test.describe.configure({ mode: 'serial' });

/** The test build on this test's userData, first run as the app left it. */
async function launch(): Promise<Page> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TAALCUT_RENDERER_URL',
    ),
  );
  app = await launchElectron(userData, { env, colorScheme: null, firstRun: 'as-stored' });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const placeholder = await page.evaluate(() => document.querySelector('script[src$="probe.mjs"]') !== null);
  if (placeholder) throw new Error('out/ has the placeholder renderer: build with `pnpm e2e:gate`.');
  return page;
}

async function quit(): Promise<void> {
  await app?.close();
  app = undefined;
}

const newChat = (page: Page) => page.getByRole('link', { name: 'New chat' });

test.beforeAll(() => {
  userData = mkdtempSync(join(tmpdir(), 'taalcut-first-run-'));
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (userData) rmSync(userData, { recursive: true, force: true });
});

test('a Mac that has never run Taalcut opens on the welcome, not the chat', async () => {
  const page = await launch();
  await expect(page.getByRole('heading', { level: 1, name: WELCOME })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/onboarding\/?$/);
  // No shell behind it: first run is the whole window.
  await expect(newChat(page)).toHaveCount(0);
  expect(savedOnboarding(userData)?.completedAt ?? null).toBeNull();

  // Get started opens the first step, and the agent keeps it as where first run carries on.
  await page.getByRole('link', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { level: 1, name: SOURCES })).toBeVisible();
  await expect.poll(() => savedOnboarding(userData)?.step).toBe('sources');
  expect(savedOnboarding(userData)?.completedAt).toBeNull();
  await quit();
});

test('quitting part way resumes at that step; Skip for now ends first run', async () => {
  const page = await launch();
  await expect(page.getByRole('heading', { level: 1, name: SOURCES })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/onboarding\/sources$/);
  await expect(newChat(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(newChat(page)).toBeVisible();
  // The shell, with the sidebar open; on its rail in a window under 1100 px, which is every window on a small display.
  const expanded = String(!(await isNarrowWindow(page)));
  await expect(page.locator(SIDEBAR_TOGGLE)).toHaveAttribute('aria-expanded', expanded);
  await expect(await chatList(page)).toBeVisible();
  await expect.poll(() => savedOnboarding(userData)?.completedAt ?? null).not.toBeNull();
  await quit();
});

test('once first run is done, the app opens on the chat', async () => {
  const page = await launch();
  await expect(newChat(page)).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/chat/);
  await expect(page.getByRole('heading', { name: WELCOME })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: SOURCES })).toHaveCount(0);
  await quit();
});
