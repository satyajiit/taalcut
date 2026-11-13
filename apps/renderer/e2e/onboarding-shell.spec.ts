// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-ONB "Done when" (the layout and the words): every first-run screen is an app shell under the window bar. The
// steps' sidebar and every screen's actions stand still, and only the content scrolls, at 1280 × 700 and 1440 × 900,
// in light and dark, on a Mac and on Linux with the system's window controls over the bar. Off a Mac, no screen
// says "Mac". With TAALCUT_ONB_SCREENS set, each screen is also saved there as the window shows it.
import { expect, test } from '@playwright/test';
import { preferences } from './support.ts';
import {
  firstRun,
  frameBoxes,
  openScreen,
  SCREENS,
  scrollContentToEnd,
  shootWindow,
} from './onboarding-shell-support.ts';

const SIZES = [
  { width: 1280, height: 700 },
  { width: 1440, height: 900 },
] as const;

for (const system of ['mac', 'linux-nvidia'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const size of SIZES)
      test(`${system}, ${theme}, ${size.width} × ${size.height}: the sidebar and the actions stand still; only the content scrolls`, async ({
        page,
      }) => {
        test.setTimeout(90_000);
        await page.setViewportSize(size);
        await preferences(page, { theme, locale: 'en' });
        await firstRun(page, system);
        let scrolled = 0;
        for (const screen of SCREENS) {
          await openScreen(page, screen);
          await shootWindow(page, `${system}-${theme}-${size.width}x${size.height}-${screen}`);
          const before = await frameBoxes(page);
          const label = `${screen}: `;
          // The window never scrolls: the bar, the sidebar and the footer fill it exactly.
          expect(before.documentScrolls, `${label}the document scrolls`).toBe(false);
          expect(before.bar!.bottom, `${label}the bar`).toBe(52);
          expect(before.footer, `${label}no footer`).not.toBeNull();
          expect(Math.abs(before.footer!.bottom - size.height), `${label}the footer's foot`).toBeLessThan(1);
          expect(before.content!.top, `${label}the content starts under the bar`).toBe(52);
          expect(before.content!.bottom, `${label}the content ends at the footer`).toBeCloseTo(
            before.footer!.top,
            0,
          );
          if (screen === 'welcome') expect(before.sidebar, 'the welcome has no sidebar').toBeNull();
          else {
            expect(before.sidebar!.top, `${label}the sidebar starts under the bar`).toBe(52);
            expect(Math.abs(before.sidebar!.bottom - size.height), `${label}the sidebar's foot`).toBeLessThan(
              1,
            );
            await expect(page.getByRole('navigation', { name: 'Setup steps' })).toBeInViewport();
          }
          await expect(page.locator('[data-slot=onboarding-footer]')).toBeInViewport({ ratio: 1 });
          // Scrolled to its end, the content moves and nothing else does.
          await scrollContentToEnd(page);
          const after = await frameBoxes(page);
          if (before.overflow > 0) {
            scrolled += 1;
            expect(after.scrollTop, `${label}the content scrolls`).toBeGreaterThan(0);
            await shootWindow(page, `${system}-${theme}-${size.width}x${size.height}-${screen}-scrolled`);
          }
          expect(after.sidebar, `${label}the sidebar moved`).toEqual(before.sidebar);
          expect(after.footer, `${label}the footer moved`).toEqual(before.footer);
          expect(after.bar, `${label}the bar moved`).toEqual(before.bar);
          expect(after.documentScrolls).toBe(false);
        }
        // At least the alpha's terms run past a 700 px window's content (UX4: the steps are shorter; the hardware
        // step that used to is gone).
        if (size.height === 700) expect(scrolled).toBeGreaterThan(0);
      });

test('the Linux title bar: the system’s controls over the bar, the bar still the drag region, the frame under it', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await firstRun(page, 'linux-nvidia');
  for (const screen of ['welcome', 'sources'] as const) {
    await openScreen(page, screen);
    const bar = page.locator('[data-slot=window-bar]');
    await expect(bar).toHaveClass(/\bapp-drag\b/);
    await expect(bar.locator('[data-slot=window-bar-system-controls]')).toHaveCount(1);
    await expect(bar.getByRole('group', { name: 'Window controls' })).toHaveCount(0);
    // Nothing that scrolls or takes a click is a drag region.
    expect(await page.locator('main .app-drag, main[class*="app-drag"]').count()).toBe(0);
  }
});

test('off a Mac, no first-run screen says “Mac”', async ({ page }) => {
  test.setTimeout(90_000);
  await preferences(page, { theme: 'light', locale: 'en' });
  await firstRun(page, 'linux-nvidia');
  // Shared parts say this computer's words too (UX3-MAC): Settings › Privacy's crash-report row on the terms step and
  // Settings › Models' profile picker under the ways to think (on the last step, UX4).
  const says = async (where: string) => {
    expect(await page.locator('main').textContent(), where).not.toMatch(/\bMac(s|’s|'s)?\b|macOS/);
  };
  for (const screen of SCREENS) {
    await openScreen(page, screen);
    await says(screen);
  }
  // The ways inside the steps: each way to think's panel (the last step's moment opens them), and the folder and
  // the cable.
  await openScreen(page, 'first-video');
  await page.locator('[data-action="quiet-check-open"]').click();
  for (const id of ['api-key', 'local-only']) {
    await page.locator(`li[data-way="${id}"] > button`).click();
    await says(`thinking, ${id}`);
  }
  await openScreen(page, 'sources');
  for (const id of ['folder', 'cable']) {
    await page.locator(`li[data-way="${id}"] > button`).click();
    await expect(page.locator(`[data-way-panel="${id}"]`)).toBeVisible();
    await says(`sources, ${id}`);
  }
});
