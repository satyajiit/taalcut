// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-ONB "Done when": the chip marks, each maker's colour toned per theme, on the Mac, the RTX 4090 host, an AMD
// desktop and an Intel laptop (UX4: in Settings › This Mac, since first run no longer shows the hardware); and "Where are your videos?" with its pairing QR read back as
// a phone's camera reads it. The QR carries the session's pairing token (`#k=…`), so a phone that scans it skips the
// setup code, and never the PIN: a photo of the code alone can't connect (packages/transfer SPEC, Pairing).
import { expect, test } from '@playwright/test';
import { preferences } from './support.ts';
import { expectAccessible } from './ui2b-support.ts';
import { firstRun, openScreen, readQr, shootWindow } from './onboarding-shell-support.ts';

/** The makers' tones (src/features/hardware/chip-mark.tsx VENDOR_TONES) as the page computes them. */
const TONES = {
  apple: { light: 'rgb(29, 29, 31)', dark: 'rgb(245, 245, 247)' },
  intel: { light: 'rgb(0, 104, 181)', dark: 'rgb(0, 199, 253)' },
  amd: { light: 'rgb(212, 17, 30)', dark: 'rgb(255, 90, 95)' },
  nvidia: { light: 'rgb(74, 122, 0)', dark: 'rgb(118, 185, 0)' },
} as const;

const MACHINES = [
  ['mac', 'apple', 'Apple', 'apple', 'Apple'],
  ['linux-nvidia', 'intel', 'Intel', 'nvidia', 'NVIDIA'],
  ['linux-amd', 'amd', 'AMD', 'amd', 'AMD'],
  ['linux-intel', 'intel', 'Intel', 'intel', 'Intel'],
] as const;

for (const [system, cpu, , gpu] of MACHINES)
  for (const theme of ['light', 'dark'] as const)
    test(`${system} in ${theme}: the processor's and the GPU's makers, by mark`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await firstRun(page, system);
      // The set lane moved the processor and the GPU from About to This Mac (UX4).
      await page.goto('/settings/this-mac');
      const names = page.locator('[data-slot=chip-name]');
      await expect(names.first()).toBeVisible();
      await expect(names).toHaveCount(2);
      for (const [i, vendor] of [
        [0, cpu],
        [1, gpu],
      ] as const) {
        const name = names.nth(i);
        await expect(name).toHaveAttribute('data-vendor', vendor);
        const mark = name.locator('[data-slot=chip-mark]');
        await expect(mark).toBeVisible();
        expect(await mark.evaluate((svg) => getComputedStyle(svg).color)).toBe(TONES[vendor][theme]);
      }
      await shootWindow(page, `marks-${system}-${theme}-this-mac`);
      await expectAccessible(page, testInfo, `this mac, ${system}, ${theme}`);
    });

test('Where are your videos? The QR carries the pairing token and never the PIN; a new code is a new QR', async ({
  page,
}, testInfo) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await firstRun(page, 'linux-nvidia');
  await openScreen(page, 'sources');
  await page.locator('li[data-way="wifi"] > button').click();
  const qr = page.locator('[data-slot=qr-code]');
  await expect(qr).toBeVisible({ timeout: 15_000 });
  const payload = await readQr(page);
  testInfo.annotations.push({ type: 'decoded QR payload', description: payload });
  console.warn(`decoded QR payload: ${payload}`);
  // The address the phone opens (the one the page offers to copy), then the session's pairing token in the fragment,
  // which a browser never sends to the server; nothing else.
  const address = await page
    .locator('[data-slot=pairing] span[translate=no].tabular-nums')
    .first()
    .innerText();
  expect(address).toBe('http://192.168.1.24:52817');
  expect(payload).toMatch(/^http:\/\/192\.168\.1\.24:52817\/#k=[A-Za-z0-9_-]{16,}$/);
  const pin = (await page.locator('[data-slot=pin] [aria-hidden]').innerText()).replace(/\D/g, '');
  expect(pin).toMatch(/^\d{6}$/);
  expect(payload).not.toContain(pin);
  // The setup code stands in for the token when the camera can't scan; it isn't in the QR either.
  const code = (await page.locator('[data-slot=pairing] span.tracking-wider').innerText()).replace(/\s/g, '');
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  expect(payload).not.toContain(code);

  // New code and PIN: the old token stops working, and the QR carries the new one.
  await page.getByRole('button', { name: 'New code and PIN' }).click();
  await expect.poll(() => readQr(page)).not.toBe(payload);
  expect(await readQr(page)).toMatch(/^http:\/\/192\.168\.1\.24:52817\/#k=[A-Za-z0-9_-]{16,}$/);
});

test('Where are your videos? Three ways as tiles; the chosen one opens under them, on the column’s edge', async ({
  page,
}, testInfo) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await firstRun(page, 'mac');
  await openScreen(page, 'sources');
  const tiles = page.locator('ul[aria-label="Ways to bring in videos"] > li > button');
  await expect(tiles).toHaveCount(3);
  const boxes = await tiles.evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().toJSON()));
  // Side by side, the same height, on one row.
  expect(new Set(boxes.map((box: DOMRect) => Math.round(box.top))).size).toBe(1);
  expect(new Set(boxes.map((box: DOMRect) => Math.round(box.height))).size).toBe(1);
  const heading = await page.locator('h1').boundingBox();
  await tiles.nth(1).click();
  await expect(tiles.nth(1)).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator('[role=region][data-way-panel="wifi"]');
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-slot=qr-code]')).toBeVisible({ timeout: 15_000 });
  // The panel, its band and the QR's plate all start on the heading's left edge: one edge for the whole step.
  for (const part of [panel, panel.locator('[data-slot=listening]'), panel.locator('figure[data-plate]')]) {
    const box = await part.boundingBox();
    expect(Math.abs(box!.x - heading!.x), 'aligned with the heading').toBeLessThan(1);
  }
  await expect(panel.locator('figure[data-plate]')).toHaveAttribute('data-plate', 'raised');
  // Choosing another way closes this one (and the Mac stops listening with it).
  await tiles.nth(0).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('[role=region][data-way-panel="folder"] [data-slot=drop-zone]')).toBeVisible();
  await expectAccessible(page, testInfo, 'sources, the folder open');
});

for (const system of ['mac', 'linux-nvidia'] as const)
  for (const theme of ['light', 'dark'] as const)
    test(`${system} in ${theme}: the Wi-Fi way open, its QR on a raised plate, the actions still in place`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await preferences(page, { theme, locale: 'en' });
      await firstRun(page, system);
      await openScreen(page, 'sources');
      await page.locator('li[data-way="wifi"] > button').click();
      await expect(page.locator('[data-slot=qr-code]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-slot=onboarding-footer]')).toBeInViewport({ ratio: 1 });
      await shootWindow(page, `${system}-${theme}-1440x900-sources-wifi`);
      await page.locator('[data-onboarding=content]').evaluate((content) => {
        content.scrollTop = content.scrollHeight;
      });
      await shootWindow(page, `${system}-${theme}-1440x900-sources-wifi-scrolled`);
      await expectAccessible(page, testInfo, `sources, Wi-Fi, ${system}, ${theme}`);
    });
