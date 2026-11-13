// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3 (phn): the phone page's bar (the lockup and the four steps) stays at the top while the step under it
// scrolls, on an iPhone 15 and a Pixel 8 (Playwright's profiles, in Chromium: WebKit isn't installed here),
// upright and on their side: a long list of videos sending, then arrived, the PIN with the keyboard up.
// Each state is photographed in the viewport, at the top and scrolled, so the pictures show what the phone shows.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import {
  type Clip,
  expectPhoneFit,
  openPhone,
  pairPhone,
  pick,
  profile,
  rows,
  view,
} from './phone-page-support.ts';

test.describe.configure({ timeout: 120_000 });

const UPRIGHT = [profile('iPhone 15'), profile('Pixel 8')];
const ON_SIDE = [profile('iPhone 15 landscape'), profile('Pixel 8 landscape')];

/** Twenty-three clips that arrive, then one that holds part-way, so the list stays on the sending step. */
const LONG: readonly Clip[] = [
  ...Array.from({ length: 23 }, (_, i) => ({
    name: `beach-day-${String(i + 1).padStart(2, '0')}.mov`,
    size: 900_000 + i * 50_000,
  })),
  { name: 'golden-hour-b-roll.mp4', size: 2_600_000 },
];
const ALL_ARRIVE: readonly Clip[] = LONG.slice(0, 23);

async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect().toJSON() as DOMRect;
    const visible = [...document.querySelectorAll('.screen:not([hidden]) .rows > li')].map((li) =>
      li.getBoundingClientRect().toJSON(),
    ) as DOMRect[];
    return {
      scrollY: window.scrollY,
      scrollable: document.documentElement.scrollHeight > window.innerHeight,
      innerHeight: window.innerHeight,
      bar: box('#topbar'),
      beats: box('#beats'),
      lockup: box('#lockup'),
      // Every caller has rows on screen; with none, reading .top fails the test.
      firstRow: visible[0] as DOMRect,
      lastRow: visible.at(-1) as DOMRect,
      scrolled: document.getElementById('topbar')?.hasAttribute('data-scrolled') ?? false,
      barVar: getComputedStyle(document.documentElement).getPropertyValue('--bar-block').trim(),
    };
  });
}

/** The bar sits at the very top of the viewport, whole, with the steps inside it. */
function expectBarAtTop(g: Awaited<ReturnType<typeof geometry>>, label: string): void {
  expect(g.bar.top, `${label}: the bar moved`).toBe(0);
  expect(g.beats.top, `${label}: the steps left the bar`).toBeGreaterThanOrEqual(g.bar.top);
  expect(g.beats.bottom, `${label}: the steps left the bar`).toBeLessThanOrEqual(g.bar.bottom + 0.5);
  expect(g.lockup.top, `${label}: the lockup left the bar`).toBeGreaterThanOrEqual(0);
  expect(g.barVar, `${label}: --bar-block`).toBe(`${Math.ceil(g.bar.height)}px`);
}

async function scrollToEnd(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('#topbar')).toHaveAttribute('data-scrolled', '');
}

for (const device of UPRIGHT) {
  test(`${device.name}: the bar stays while a long list scrolls, sending and done`, async ({
    browser,
  }, testInfo) => {
    const { page, problems, close } = await openPhone(browser, device, { theme: 'light' });
    await pairPhone(page);
    await pick(page, device, LONG);
    await expect(rows(page)).toHaveCount(LONG.length);
    await expect(rows(page).filter({ hasText: 'Added' })).toHaveCount(23, { timeout: 30_000 });

    const top = await geometry(page);
    expect(top.scrollable, 'the list is longer than the screen').toBe(true);
    expect(top.scrollY).toBe(0);
    expect(top.scrolled, 'no hairline before anything scrolled').toBe(false);
    expectBarAtTop(top, 'sending, top');
    expect(top.firstRow.top, 'the first row starts below the bar').toBeGreaterThanOrEqual(top.bar.bottom);
    await expectPhoneFit(page, 'sending, top');
    await view(page, `${device.name}-sending-top`);

    await scrollToEnd(page);
    const end = await geometry(page);
    expect(end.scrollY, 'the page scrolled').toBeGreaterThan(200);
    expectBarAtTop(end, 'sending, scrolled');
    expect(end.firstRow.top, 'the first row went under the bar').toBeLessThan(end.bar.bottom);
    expect(end.lastRow.bottom, 'the last row is in view').toBeLessThanOrEqual(end.innerHeight);
    await expectAccessible(page, testInfo, 'sending, scrolled');
    await view(page, `${device.name}-sending-scrolled`);
    await close();

    // Everything arrives: the done step opens at its top, then scrolls under the bar the same way.
    const done = await openPhone(browser, device, { theme: 'dark' });
    await pairPhone(done.page);
    await pick(done.page, device, ALL_ARRIVE);
    await done.page.waitForTimeout(1_500);
    await done.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(done.page.locator('#screen-done')).toBeVisible({ timeout: 30_000 });
    await expect(done.page.locator('#done-title')).toHaveText('All on your Mac');
    const landed = await geometry(done.page);
    expect(landed.scrollY, 'a new step starts at its top').toBe(0);
    expectBarAtTop(landed, 'done, top');
    await view(done.page, `${device.name}-done-top`);
    await scrollToEnd(done.page);
    const doneEnd = await geometry(done.page);
    expectBarAtTop(doneEnd, 'done, scrolled');
    expect(doneEnd.lastRow.bottom).toBeLessThanOrEqual(doneEnd.innerHeight);
    await expect(done.page.locator('#done-more')).toBeInViewport();
    await view(done.page, `${device.name}-done-scrolled`);
    expect(problems).toEqual([]);
    expect(done.problems).toEqual([]);
    await done.close();
  });

  test(`${device.name}: with the keyboard up, the PIN stays in view under the bar`, async ({ browser }) => {
    const { page, close } = await openPhone(browser, device, { theme: 'light', token: false });
    // The page asks the browser to resize its content for the keyboard (interactive-widget): a shorter viewport.
    await page.setViewportSize({ width: device.width, height: Math.round(device.height * 0.55) });
    await page.locator('#pin .digit').nth(3).focus();
    await page.keyboard.type('48');
    const g = await geometry(page);
    const digit = await page.evaluate(
      () => document.activeElement?.getBoundingClientRect().toJSON() as DOMRect,
    );
    await expect(page.locator('#pin .digit:focus')).toHaveCount(1);
    expectBarAtTop(g, 'keyboard');
    // Still upright: the keyboard makes the page wider than tall, but the steps stay under the lockup.
    expect(g.beats.top, 'the steps stay under the lockup').toBeGreaterThanOrEqual(g.lockup.bottom);
    expect(digit.top, 'the PIN box is below the bar').toBeGreaterThanOrEqual(g.bar.bottom);
    expect(digit.bottom, 'the PIN box is above the keyboard').toBeLessThanOrEqual(g.innerHeight);
    await view(page, `${device.name}-pair-keyboard`);
    await close();
  });
}

for (const device of ON_SIDE) {
  test(`${device.name}: on its side the bar is one row, and stays while the list scrolls`, async ({
    browser,
  }) => {
    const { page, problems, close } = await openPhone(browser, device, { theme: 'dark' });
    const bar = await geometry(page);
    // One row: the steps beside the lockup, not under it.
    expect(bar.beats.top).toBeLessThan(bar.lockup.bottom);
    expect(bar.bar.height).toBeLessThan(device.height * 0.25);
    await view(page, `${device.name}-pair`);
    await pairPhone(page);
    await pick(page, device, LONG);
    await expect(rows(page).filter({ hasText: 'Added' })).toHaveCount(23, { timeout: 30_000 });
    await view(page, `${device.name}-sending-top`);
    await scrollToEnd(page);
    const end = await geometry(page);
    expectBarAtTop(end, 'on its side, scrolled');
    expect(end.lastRow.bottom).toBeLessThanOrEqual(end.innerHeight);
    await expectPhoneFit(page, 'on its side, scrolled');
    await view(page, `${device.name}-sending-scrolled`);
    expect(problems).toEqual([]);
    await close();
  });
}
