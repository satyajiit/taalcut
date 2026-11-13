// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Kaatu as a companion (UX4, DESIGN.md "Mascot"): at the sidebar's foot on every page in the shell, 40 px open and
// 32 on the rail, on the rows' icon column; decorative and never a control; calm (it doesn't follow the pointer);
// its breath a CSS animation that holds while the window isn't in front. Its mood follows the app's work. Show
// Kaatu off hides it and every decorative Kaatu, and keeps the words. The chat start's first-visit tip stays
// dismissed.
import { expect, test, type Page } from '@playwright/test';
import { ARTIFACTS, fakeChat, open, preferences, watchProblems } from './support.ts';

const NEW_CHAT = '/chat/01K7C5M6Q8R9S0T1V2W3X4YZZZ';
const PROMPT = "Add my Desktop/Trip folder and tell me what's in the first video";
const companion = (page: Page) => page.locator('[data-slot=companion]');
const kaatu = (page: Page) => companion(page).locator('[data-slot=mascot]');
const sprite = (page: Page) => kaatu(page).locator('[data-slot=mascot-breath] > span').first();
const tip = (page: Page) => page.locator('[data-slot=kaatu-moment][data-tone=tip]');

test.beforeEach(async ({ page }) => {
  await preferences(page, { locale: 'en', theme: 'light' });
  await fakeChat(page, { latencyMs: 50 });
});

test('sits at the sidebar’s foot on the icon column, smaller on the rail, and is no control', async ({
  page,
}) => {
  const problems = await watchProblems(page);
  await open(page, { name: 'projects', path: '/projects' });
  await expect(kaatu(page)).toHaveAttribute('data-spot', 'companion');
  const open40 = (await kaatu(page).boundingBox())!;
  expect(Math.round(open40.width)).toBe(40);
  // Above Settings, and centred where the rows' icons are.
  const settings = (await page.getByRole('navigation', { name: 'App' }).boundingBox())!;
  expect(open40.y + open40.height).toBeLessThanOrEqual(settings.y);
  const icon = (await page.getByRole('link', { name: 'Library' }).locator('svg').first().boundingBox())!;
  expect(Math.abs(open40.x + open40.width / 2 - (icon.x + icon.width / 2))).toBeLessThanOrEqual(1);
  // Decorative, and nothing to tab to.
  await expect(companion(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(companion(page).locator('button, a, [tabindex]')).toHaveCount(0);

  await page.locator('[data-slot=window-bar]').getByRole('button', { name: 'Sidebar' }).click();
  await expect(page.locator('[data-slot=sidebar][data-rail]')).toBeVisible();
  await expect
    .poll(async () => Math.round((await kaatu(page).boundingBox())?.width ?? 0), { timeout: 3000 })
    .toBe(32);
  const rail = (await kaatu(page).boundingBox())!;
  const sidebar = (await page.locator('[data-slot=sidebar]').boundingBox())!;
  expect(Math.abs(rail.x + rail.width / 2 - (sidebar.x + sidebar.width / 2))).toBeLessThanOrEqual(1);
  expect(problems).toEqual([]);
});

test('is calm: it doesn’t turn to the pointer, and a poke still gets a reaction', async ({ page }) => {
  await open(page, { name: 'projects', path: '/projects' });
  const box = (await kaatu(page).boundingBox())!;
  const before = await sprite(page).getAttribute('data-direction');
  await page.mouse.move(900, 100, { steps: 4 });
  await page.mouse.move(900, 780, { steps: 4 });
  await page.waitForTimeout(400);
  expect(await sprite(page).getAttribute('data-direction')).toBe(before);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(sprite(page)).toHaveAttribute('data-reaction', /content|heart/);
});

test('breathes on the compositor, and holds its breath while the window isn’t in front', async ({ page }) => {
  await open(page, { name: 'projects', path: '/projects' });
  const breath = kaatu(page).locator('[data-slot=mascot-breath]');
  const states = () =>
    breath.evaluate((el) =>
      el.getAnimations().map((a) => `${(a as CSSAnimation).animationName} ${a.playState}`),
    );
  expect(await states()).toEqual(['tc-kaatu-breath running']);
  await page.evaluate(() => (document.documentElement.dataset.windowActive = 'false'));
  expect(await states()).toEqual(['tc-kaatu-breath paused']);
  await page.evaluate(() => (document.documentElement.dataset.windowActive = 'true'));
  expect(await states()).toEqual(['tc-kaatu-breath running']);
});

test('thinks while the agent works, and grins when the run ends well', async ({ page }) => {
  // The library's analysis holds still: the window bar reads it on every page (LIB1-PROG), and Kaatu thinks while
  // clips are analysed, which isn't the agent's work this checks.
  await fakeChat(page, { latencyMs: 50, speed: 0.75, indexingTickMs: 0 });
  await open(page, { name: 'chat-new', path: NEW_CHAT });
  await expect(companion(page)).toHaveAttribute('data-mood', /idle|sleep/);
  const box = page.getByRole('textbox', { name: 'Message Taalcut' });
  await box.fill(PROMPT);
  await box.press('Enter');
  await expect(companion(page)).toHaveAttribute('data-mood', 'thinking');
  await expect(companion(page)).toHaveAttribute('data-mood', 'happy', { timeout: 30_000 });
  await expect(companion(page)).toHaveAttribute('data-mood', /idle|sleep/, { timeout: 5_000 });
});

test('Show Kaatu off: the companion and the page’s Kaatu go, the words stay', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('taalcut.kaatu', 'off'));
  await open(page, { name: 'chat-new', path: NEW_CHAT });
  await expect(page.getByRole('heading', { name: 'Tell Taalcut what to make' })).toBeVisible();
  await expect(page.locator('[data-slot=mascot]')).toHaveCount(0);
  await expect(companion(page)).toHaveCount(0);
  await open(page, { name: 'not-found', path: '/no-such-page' });
  await expect(page.getByRole('heading', { level: 1, name: "This page doesn't exist" })).toBeVisible();
  await expect(page.locator('[data-slot=mascot]')).toHaveCount(0);
  // About introduces Kaatu by name: it stays.
  await open(page, { name: 'settings-about', path: '/settings/about' });
  await expect(page.getByRole('img', { name: 'Kaatu, Taalcut’s beaver' })).toBeVisible();
});

test('the chat start’s tip shows once, and stays dismissed', async ({ page }) => {
  await open(page, { name: 'chat-new', path: NEW_CHAT });
  await expect(tip(page)).toContainText('Recent chats');
  // Words alone: the chat start already has Kaatu beside its heading.
  await expect(tip(page).locator('[data-slot=mascot]')).toHaveCount(0);
  await page.screenshot({ path: new URL('screenshots/kaatu/chat-start-tip.png', ARTIFACTS).pathname });
  // From the keyboard: the button goes with the tip, and focus stays in the page (its main area), not the body.
  await tip(page).getByRole('button', { name: 'Dismiss tip' }).focus();
  await page.keyboard.press('Enter');
  await expect(tip(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tell Taalcut what to make' })).toBeVisible();
  await expect(tip(page)).toHaveCount(0);
});
