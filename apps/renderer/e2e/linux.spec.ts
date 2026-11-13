// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LNX1-SHL "Done when", in the browser: the app as it runs on the Linux fixtures (src/backend/fake/fake-system.ts),
// the RTX 4090 host and the same host with its GPU hidden. "This computer" off a Mac with the GPU's memory and
// driver; a probe that fails never holds first run; shortcuts in a PC's words; and, with the system drawing the
// window's controls over the bar (Electron's titleBarOverlay; navigator.windowControlsOverlay, stubbed here), the
// bar draws none of its own and leaves their corner free, so the window has one title bar. In the pseudo-locale
// nothing on these screens is English or clipped.
import { expect, test, type Page } from '@playwright/test';
import { action, atStep, expectDispatched } from './onboarding-support.ts';
import { open, preferences } from './support.ts';
import { expectPseudoClean, fakes, type Ui2bFakeOptions } from './ui2b-support.ts';

const NVIDIA: Ui2bFakeOptions = { onboarding: 'done', system: 'linux-nvidia', library: 'empty' };
const CPU: Ui2bFakeOptions = { onboarding: 'done', system: 'linux-cpu', library: 'empty' };
/** UX4: the hardware is its own page under General (This Mac, "This computer" off a Mac); About keeps the version. */
const THIS_COMPUTER = { name: 'this-computer', path: '/settings/this-mac' };

/** The facts in This computer's list (Settings › General › This computer), by name. */
async function facts(page: Page): Promise<Record<string, string>> {
  const list = page.locator('dl[aria-label="This computer"]');
  await expect(list.locator('dt').first()).toBeVisible();
  return list.evaluate((dl) =>
    Object.fromEntries(
      [...dl.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? '']),
    ),
  );
}

/** Chromium's window controls overlay as Electron's titleBarOverlay shows it: on, 140 px of controls at the right. */
async function systemControls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const overlay = new EventTarget();
    Object.defineProperty(overlay, 'visible', { get: () => true });
    Object.defineProperty(navigator, 'windowControlsOverlay', { get: () => overlay });
  });
}

test.describe('Linux with an NVIDIA GPU', () => {
  test('This computer: the processor, the GPU with its memory and driver, Ubuntu by name', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakes(page, NVIDIA);
    await open(page, THIS_COMPUTER);
    // Its view is named in this computer's words too.
    await expect(
      page.locator('[data-slot=settings-views]').getByRole('link', { name: 'This computer', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    const found = await facts(page);
    expect(found).toMatchObject({
      Processor: '13th Gen Intel(R) Core(TM) i9-13900K',
      Graphics: 'NVIDIA GeForce RTX 4090 · 24 GB · CUDA · driver 615.71.09',
      System: 'Ubuntu 24.04.5 LTS',
    });
    const section = page.getByRole('region', { name: 'Hardware', exact: true });
    await expect(section).not.toContainText(/\bMac\b/);
    await expect(page.getByRole('region', { name: 'Where work runs on this computer' })).toContainText(
      'GPU (CUDA)',
    );
  });

  test('first run asks nothing about this computer: no spec sheet, and no step says “Mac”', async ({
    page,
  }) => {
    // UX4: the hardware is checked quietly; Settings › About keeps the details (the tests above).
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakes(page, { ...NVIDIA, onboarding: 'fresh', channel: 'stable', downloadTickMs: 0 });
    await page.goto('/onboarding/hardware');
    await atStep(page, 'first-video');
    await expect(page.locator('[data-slot=hardware-row], [data-slot=machine-facts]')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/\bMac\b/);
  });

  test('shortcuts are a PC’s keys: Ctrl, not ⌘', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakes(page, NVIDIA);
    await open(page, { name: 'library', path: '/library' });
    const sidebar = page.locator('[data-slot=window-bar] button[aria-controls=app-sidebar]');
    // The sidebar is Ctrl+B on a PC (core's pcShortcut): ⌃⌘S would be Ctrl+S, Save.
    await expect(sidebar).toHaveAttribute('aria-keyshortcuts', 'Control+B');
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible();
    await expect(palette.locator('kbd').filter({ hasText: 'Ctrl' }).first()).toBeVisible();
    await expect(palette).not.toContainText('⌘');
    await page.keyboard.type('sidebar');
    const option = palette.getByRole('option', { name: /Collapse sidebar/ });
    await expect(option.locator('kbd')).toHaveText(['Ctrl', 'B']);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Commands' })).toHaveCount(0);
    // Once ⌘K has listed it, the page binds it too: the preview toggles the sidebar on Ctrl+B, not Ctrl+S.
    await page.keyboard.press('Control+KeyS');
    await expect(sidebar).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Control+KeyB');
    await expect(sidebar).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Control+KeyB');
    await expect(sidebar).toHaveAttribute('aria-expanded', 'true');
  });

  test('with the system’s controls over the bar, the bar draws none and leaves their corner free', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakes(page, NVIDIA);
    await systemControls(page);
    await open(page, { name: 'library', path: '/library' });
    const bar = page.locator('[data-slot=window-bar]');
    await expect(bar.getByRole('group', { name: 'Window controls' })).toHaveCount(0);
    await expect(bar.locator('[data-slot=window-bar-system-controls]')).toHaveCount(1);
    // One title bar: the page's h1 in the bar, and the bar still the window's drag region.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(bar).toHaveClass(/\bapp-drag\b/);
  });

  test('without the overlay (a Mac, a browser) the bar keeps its own controls', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakes(page, NVIDIA);
    await open(page, { name: 'library', path: '/library' });
    const bar = page.locator('[data-slot=window-bar]');
    await expect(bar.getByRole('group', { name: 'Window controls' })).toBeVisible();
    await expect(bar.locator('[data-slot=window-bar-system-controls]')).toHaveCount(0);
  });
});

test.describe('Linux with no GPU for models', () => {
  test('This computer says why the tier is Minimum and why each job runs on the CPU', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakes(page, CPU);
    await open(page, THIS_COMPUTER);
    const section = page.getByRole('region', { name: 'Hardware', exact: true });
    await expect(section).toContainText('Minimum tier');
    await expect(section).toContainText('Taalcut found no graphics chip it can run models on');
    expect(Object.keys(await facts(page))).not.toContain('Graphics');
    const compute = page.getByRole('region', { name: 'Where work runs on this computer' });
    await expect(
      compute.getByText('Taalcut found no graphics chip it can run this on, so it runs on the CPU.'),
    ).toHaveCount(2);
  });
});

test('a probe that fails holds nothing: first run goes on, the download starts', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { ...NVIDIA, onboarding: 'fresh', channel: 'stable', downloadTickMs: 0, probe: 'error' });
  await page.goto('/onboarding/sources');
  await atStep(page, 'sources');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectDispatched(page, 'components.download');
  await action(page, 'later').click();
  await atStep(page, 'first-video');
  await expect(page.locator('[data-slot=probe-failed]')).toHaveCount(0);
});

test.describe('pseudo-locale on Linux', () => {
  // As pseudo-locale.spec.ts: narrower than the default window, so long translations have less room.
  test.use({ viewport: { width: 1024, height: 720 } });

  for (const [label, options, path] of [
    ['this computer, NVIDIA', NVIDIA, THIS_COMPUTER.path],
    ['this computer, CPU only', CPU, THIS_COMPUTER.path],
    // LNX1-TRM: the NVIDIA GPU setup card's other states.
    ['this computer, a GPU before Turing', { ...NVIDIA, system: 'linux-pascal' }, THIS_COMPUTER.path],
    // About: the version, the licences and help, in this computer's words.
    ['about', NVIDIA, '/settings/about'],
  ] as const) {
    test(`${label}: everything translated, nothing clipped`, async ({ page }) => {
      await preferences(page, { theme: 'light', locale: 'en-XA' });
      await fakes(page, options);
      await open(page, { name: 'this-computer', path });
      await expect(
        page.locator(path === THIS_COMPUTER.path ? 'dl[aria-label]' : '[data-component=taalcut]').first(),
      ).toBeVisible();
      await expectPseudoClean(page, label);
    });
  }

  test('Settings › Models › Downloads, NVIDIA’s terms opened from their row: everything translated, nothing clipped', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await fakes(page, { ...NVIDIA, downloadTickMs: 0 });
    await open(page, { name: 'models', path: '/settings/models/downloads' });
    await page.locator('[data-slot=cuda-runtime-row] button').click();
    await expect(page.locator('[data-slot=nvidia-terms]')).toBeVisible();
    await expectPseudoClean(page, 'settings, NVIDIA’s terms');
  });

  for (const [label, options] of [
    ['an old NVIDIA driver', { system: 'linux-nvidia-old-driver' }],
    ['no NVIDIA driver', { system: 'linux-nouveau' }],
  ] as const) {
    // UX4: these guide the person from Settings › Models › Downloads, not first run (nothing waits on them).
    test(`Settings › Models › Downloads, ${label}: everything translated, nothing clipped`, async ({
      page,
    }) => {
      await preferences(page, { theme: 'light', locale: 'en-XA' });
      await fakes(page, { downloadTickMs: 0, ...options });
      await open(page, { name: 'models-downloads', path: '/settings/models/downloads' });
      await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
      await expect(page.locator('[data-slot=gpu-setup]').first()).toBeVisible();
      await expectPseudoClean(page, `settings, ${label}`);
    });
  }

  test('first run’s last step, NVIDIA’s terms from Kaatu’s moment: everything translated, nothing clipped', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await fakes(page, {
      system: 'linux-nvidia',
      onboarding: 'fresh',
      channel: 'stable',
      library: 'empty',
      downloadTickMs: 0,
      localOnly: true,
    });
    await page.goto('/onboarding/first-video');
    await expect(page.locator('[data-slot=quiet-check][data-need=terms]')).toBeVisible();
    await page.locator('[data-action="quiet-check-open"]').click();
    await expect(page.locator('[data-slot=nvidia-terms]')).toBeVisible();
    await expectPseudoClean(page, 'first run, NVIDIA’s terms');
  });
});
