// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P2-X4 and P3-B3 "Done when" (the automated part): the scripted first run reaches an imported library and a
// first video from a starter template, timed; the terms step follows the build (alpha, beta, none); progress and
// the branch inside a step are saved as you go, so a reload resumes there; Skip ends first run from any step; the
// whole path works from the keyboard; reduced motion fades; each step is axe-clean in light and dark. This Mac
// starts the download of everything it needs by itself (UX2-DOWNLOADER: `components.download`; nothing to pick).
// UX4, the owner's order: the welcome, where your videos are (the import shows there), the terms when the build has
// them, then a reel or a starter. How Taalcut thinks is asked on the last step only when nothing can think yet, as
// Kaatu's moment with the ways a press away; the old steps' addresses go on to the step that holds them now.
import { expect, test } from '@playwright/test';
import { open, preferences } from './support.ts';
import { expectAccessible, fakes, shoot } from './ui2b-support.ts';
import {
  action,
  atStep,
  carryOn,
  commandNames,
  expectDispatched,
  openWay,
  progress,
  startImport,
  way,
} from './onboarding-support.ts';

test('a fresh Mac: first run reaches an imported library and a first video from a starter', async ({
  page,
}, testInfo) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, {
    onboarding: 'fresh',
    channel: 'beta',
    library: 'empty',
    indexingTickMs: 10,
    downloadTickMs: 60,
  });
  const started = Date.now();
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
  await action(page, 'get-started').click();

  await atStep(page, 'sources');
  // Everything this Mac needs starts downloading at once, in the background: nothing to see or pick.
  await expectDispatched(page, 'components.download');
  await expect(action(page, 'continue')).toBeDisabled();
  await openWay(page, 'folder');
  await startImport(page);
  await expect(page.getByRole('region', { name: 'Import progress' })).toBeVisible();
  const imported = Date.now() - started;
  await carryOn(page);

  await atStep(page, 'beta');
  await expect(page.getByRole('switch', { name: 'Share usage counts' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(page.getByRole('switch', { name: 'Send crash reports' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.getByRole('switch', { name: 'Share usage counts' }).click();
  await carryOn(page);

  await atStep(page, 'first-video');
  // Nothing can think yet: Kaatu says so on the last step, and the ways to connect are one press away.
  await expect(action(page, 'make-first-video')).toBeDisabled();
  await action(page, 'quiet-check-open').click();
  await openWay(page, 'chatgpt');
  await action(page, 'chatgpt-sign-in').click();
  // Signed in: the row says so in OpenAI's own words, and stays in view.
  await expect(page.locator('li[data-way="chatgpt"] > button')).toContainText('Using ChatGPT plan');
  await page.locator('li[data-path="template"] > button').click();
  await expect(page.locator('[data-starter="weekend-trip"] input')).toBeChecked();
  await expect(page.locator('[data-slot=step-moment]')).toContainText('That’s all it takes');
  await action(page, 'make-first-video').click();
  await expect(page).toHaveURL(/\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/);
  await expectDispatched(page, 'template.addStarter');

  const saved = await progress(page);
  expect(saved.completedAt).not.toBeNull();
  expect(saved.completedVia).toBe('finished');
  expect(saved.branch).toMatchObject({ thinking: 'chatgpt', source: 'folder', starterPicker: true });
  testInfo.annotations.push({
    type: 'onboarding: welcome to imported library',
    description: `${imported} ms`,
  });
  console.warn(`onboarding: welcome to imported library in ${imported} ms (scripted, fakes)`);
  // The person's budget is five minutes on a clean Mac (a human run); the scripted path is far inside it.
  expect(imported).toBeLessThan(60_000);
});

test('the welcome: the count-in, one plain headline and a still figure; no slides, tabs or numbered eyebrow (UX1)', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { onboarding: 'fresh', channel: 'stable' });
  await page.goto('/onboarding');
  const welcome = page.locator('[data-slot=onboarding-welcome]');
  await expect(welcome.locator('[data-slot=count-in-lockup]')).toBeVisible();
  await expect(welcome.getByRole('heading', { level: 1 })).toHaveText(
    'Cut your clips to the beat of a reel you love.',
  );
  await expect(welcome.locator('[data-slot=welcome-figure]')).toBeVisible();
  await expect(welcome.getByRole('tablist')).toHaveCount(0);
  await expect(welcome.getByRole('tab')).toHaveCount(0);
  await expect(welcome).not.toContainText(/Simulate|\bSam\b|\b0[1-4]\b/);
  // The count-in is the one moving thing, once: nothing keeps moving after it lands. The page waits for its
  // animations' own ends, not a few seconds of wall clock (a busy machine's frames come late: UX2 round 2 saw all
  // twenty still running after 5 s at load 45); one that never ends keeps this waiting, and the test fails.
  const still = await page.evaluate(async () => {
    for (;;) {
      // Kaatu's own breath and blinks are its life, not the page moving (DESIGN.md "Mascot"): left out.
      const running = document
        .getAnimations()
        .filter(
          (each) =>
            each.playState === 'running' &&
            !(
              each.effect instanceof KeyframeEffect &&
              each.effect.target instanceof Element &&
              each.effect.target.closest('[data-slot=mascot]')
            ),
        );
      if (running.length === 0) return true;
      const ending = running.filter((each) => each.effect?.getComputedTiming().iterations !== Infinity);
      if (ending.length === 0) await new Promise((next) => requestAnimationFrame(next));
      else
        await Promise.all(
          ending.map((each) =>
            each.finished.then(
              () => 'ended',
              () => 'cancelled',
            ),
          ),
        );
    }
  });
  expect(still).toBe(true);
  await action(page, 'get-started').click();
  await atStep(page, 'sources');
  await page.locator('[data-slot=step-actions] [data-action="back"]').click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test('every step: Back beside the way on, and the count says where you are without changing size (UX1)', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { onboarding: 'fresh', channel: 'beta', library: 'empty' });
  const steps = ['sources', 'beta', 'first-video'];
  for (const [i, step] of steps.entries()) {
    await page.goto(`/onboarding/${step}`);
    await atStep(page, step);
    const rail = page.getByRole('navigation', { name: 'Setup steps' });
    await expect(rail).toContainText(`Step ${i + 1} of ${steps.length}`);
    const row = page.locator('[data-slot=step-actions]');
    const back = row.locator('[data-action="back"]');
    const next = row.locator(
      step === 'first-video' ? '[data-action="make-first-video"]' : '[data-action="continue"]',
    );
    await expect(back, step).toBeVisible();
    await expect(next, step).toBeVisible();
    const [backBox, nextBox] = [await back.boundingBox(), await next.boundingBox()];
    expect(backBox?.y, `${step}: Back and the way on share a row`).toBe(nextBox?.y);
    expect(backBox?.height, `${step}: the same size`).toBe(nextBox?.height);
    if (step === 'first-video') {
      await expect(next).toHaveText('Make my first video');
      await expect(row.locator('[data-action="skip"]')).toHaveText('Start without a video');
      await expect(row.getByRole('button', { name: 'Skip for now' })).toHaveCount(0);
    }
    if (step === 'beta')
      await expect(row).toContainText('Skip for now finishes setup without agreeing to these terms.');
  }
});

for (const [channel, terms, steps] of [
  ['stable', null, 2],
  ['beta', 'The beta', 3],
  ['alpha', 'The alpha', 3],
] as const) {
  test(`a ${channel} build: ${terms ?? 'no terms step'}`, async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakes(page, { onboarding: 'fresh', channel });
    await page.goto('/onboarding/sources');
    const rail = page.getByRole('navigation', { name: 'Setup steps' });
    await expect(rail).toContainText(`Step 1 of ${steps}`);
    for (const other of ['The alpha', 'The beta'])
      await expect(rail.getByRole('link', { name: other })).toHaveCount(other === terms ? 1 : 0);
    await action(page, 'later').click();
    await atStep(page, channel === 'stable' ? 'first-video' : channel);
  });
}

test('the old steps’ addresses go on to the step that holds them now', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { onboarding: 'fresh', channel: 'stable' });
  for (const [old, now] of [
    ['thinking', 'first-video'],
    ['hardware', 'first-video'],
    ['import', 'sources'],
  ] as const) {
    await page.goto(`/onboarding/${old}`);
    await atStep(page, now);
    await expect(page.getByRole('heading', { level: 1 }), old).toBeVisible();
  }
});

test('a reload resumes at the step and the way chosen in it; Skip ends first run for good', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, {
    onboarding: 'fresh',
    channel: 'stable',
    library: 'empty',
    usb: 'iphone',
    usbTickMs: 200,
  });
  await page.goto('/onboarding/sources');
  await openWay(page, 'cable');
  await expect.poll(async () => (await progress(page)).branch).toMatchObject({ source: 'cable' });
  await page.goto('/');
  await atStep(page, 'sources');
  await expect(way(page, 'cable')).toHaveAttribute('aria-expanded', 'true');

  await action(page, 'later').click();
  await atStep(page, 'first-video');
  await page.locator('li[data-path="template"] > button').click();
  await expect(page.locator('[data-starter]').first()).toBeVisible();
  await page.goto('/');
  await atStep(page, 'first-video');
  // The starter picker was open: it opens again.
  await expect(page.locator('[data-starter]').first()).toBeVisible();

  await action(page, 'skip').click();
  await expect(page).toHaveURL(/\/chat$/);
  expect((await progress(page)).completedVia).toBe('skipped');
  await page.goto('/');
  await expect(page).toHaveURL(/\/chat$/);
});

test('Skip for now ends first run from every step', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  for (const step of ['sources', 'beta', 'first-video']) {
    await fakes(page, { onboarding: 'fresh', channel: 'beta', library: 'empty' });
    await page.goto(`/onboarding/${step}`);
    await action(page, 'skip').click();
    await expect(page, step).toHaveURL(/\/chat$/);
    expect((await progress(page)).completedAt, step).not.toBeNull();
    await page.evaluate(() => window.localStorage.clear());
  }
});

test('the whole first run works from the keyboard, focus always visible', async ({ page }) => {
  await preferences(page, { theme: 'dark', locale: 'en' });
  await fakes(page, { onboarding: 'fresh', channel: 'stable', library: 'empty' });
  // The welcome rendered and settled first, as every page check does: a Tab before the app is on screen lands
  // nowhere, and the loop below would spend its presses on an empty page.
  await open(page, { name: 'onboarding', path: '/onboarding' });
  await expect(action(page, 'get-started')).toBeVisible();
  /** Tabs until the element matching `selector` has focus, checking the ring on each stop. */
  const tabTo = async (selector: string) => {
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return 'none';
        // The page's main area is a landing, not a control (as in keyboard.ts): a Tab pressed while a step leaves
        // can end there, when the step's control that had focus goes with it (lost-focus.ts).
        if (el.tagName === 'MAIN') return 'landing';
        const style = getComputedStyle(el);
        return style.outlineStyle !== 'none' && style.outlineWidth !== '0px' ? 'ring' : 'no ring';
      });
      expect(ring, 'the focused control shows its ring').not.toBe('no ring');
      if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return;
    }
    throw new Error(`never reached ${selector} with Tab`);
  };
  await tabTo('[data-action="get-started"]');
  await page.keyboard.press('Enter');
  await atStep(page, 'sources');
  await tabTo('[data-action="later"]');
  await page.keyboard.press('Enter');
  await atStep(page, 'first-video');
  // Nothing can think yet: the moment's Choose how, then Local only, all from the keyboard.
  await tabTo('[data-action="quiet-check-open"]');
  await page.keyboard.press('Enter');
  await tabTo('li[data-way="local-only"] > button');
  await page.keyboard.press('Enter');
  await tabTo('[data-action="local-only"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-slot=quiet-check]')).toHaveCount(0);
  await tabTo('li[data-path="template"] > button');
  await page.keyboard.press('Enter');
  // The starters are one radio group, the best fit chosen: Tab lands on it, the arrows would move it.
  await tabTo('[data-starter] input:checked');
  await tabTo('[data-action="make-first-video"]:not([disabled])');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(await commandNames(page)).toEqual(
    expect.arrayContaining(['privacy.setLocalOnly', 'models.setProfile', 'template.addStarter']),
  );
});

test('reduced motion: a way opens with a fade, never a slide', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { onboarding: 'fresh', channel: 'stable' });
  await page.goto('/onboarding/sources');
  await way(page, 'folder').click();
  const moving = await page.evaluate(
    () =>
      document
        .getAnimations()
        // Loaders keep turning under reduced motion, slower (DESIGN.md "Motion rules"): a stopped spinner reads
        // as a hang. Everything else that moves must fade.
        .filter(
          (animation) =>
            !(
              animation.effect instanceof KeyframeEffect &&
              animation.effect.target instanceof Element &&
              animation.effect.target.closest('.animate-spin, .spin')
            ),
        )
        .flatMap((animation) =>
          animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [],
        )
        .filter((frame) => 'transform' in frame || 'translate' in frame || 'scale' in frame).length,
  );
  expect(moving, 'transform animations under reduced motion').toBe(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`every step in ${theme}: accessible, as designed`, async ({ page }, testInfo) => {
    // Four screens, each scanned by axe and shot: about 15 s on a quiet machine, so 30 s fails under load.
    test.setTimeout(90_000);
    await preferences(page, { theme, locale: 'en' });
    await fakes(page, { onboarding: 'fresh', channel: 'beta', library: 'empty', indexingTickMs: 0 });
    await page.goto('/onboarding');
    await expect(page.locator('[data-slot=count-in-lockup]')).toBeVisible();
    await expectAccessible(page, testInfo, `onboarding welcome (${theme})`);
    await shoot(page, `onboarding-welcome-${theme}`);
    // One page load, Continue between steps: the folder added is the one Your videos brings in.
    await action(page, 'get-started').click();
    for (const step of ['sources', 'beta', 'first-video']) {
      await atStep(page, step);
      await expect(page.locator('[aria-busy=true]')).toHaveCount(0, { timeout: 10_000 });
      await expect(page.locator('[data-slot=step-actions] [data-action="back"]')).toBeVisible();
      if (step === 'sources') {
        await openWay(page, 'folder');
        await startImport(page);
        await expect(page.getByRole('region', { name: 'Import progress' })).toBeVisible();
      }
      if (step === 'first-video') {
        // Kaatu's moment with its fix open, then a way to start open: the step at its fullest.
        await action(page, 'quiet-check-open').click();
        await page.locator('li[data-path="template"] > button').click();
      }
      await expectAccessible(page, testInfo, `onboarding ${step} (${theme})`);
      await shoot(page, `onboarding-${step}-${theme}`);
      if (step !== 'first-video') await carryOn(page);
    }
  });
}
