// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expectAccessible, settle } from './axe';
import { PROJECT } from './routes';
import { fakeChat, preferences, watchProblems } from './support';

// Matches the synthetic model stream; importing its module would execute renderer-only UI macros in Node.
const FRAME_INSPECTION_PROMPT = 'Check the nine airport frames';
const FRAME_INSPECTION_INTRO =
  'I’ll sample the airport sequence, then compare the lighting and framing across the cut.';
const FRAME_INSPECTION_ANSWER =
  'The opening and middle frames have consistent lighting. The closing shot has a pink reflection in the dark sky. Keep its framing and timing, and clean up that reflection before export.';

const captures = new URL('../../../.impeccable/review/chat-streaming/', import.meta.url);
const toggle = (page: Page) => page.locator('[data-slot=run-activity-toggle]');
const activity = (page: Page) => page.locator('[data-slot=run-activity]');

async function ask(page: Page, docked = false) {
  await page.goto(docked ? `/projects/${PROJECT}/timeline` : '/chat');
  const surface = docked ? page.locator('[data-slot=editor-dock]') : page.locator('main');
  const composer = surface.locator('[data-slot=composer]').getByRole('textbox').last();
  await composer.fill(FRAME_INSPECTION_PROMPT);
  await composer.press('Enter');
  return composer;
}

async function capture(page: Page, name: string) {
  mkdirSync(captures, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  await page.screenshot({ path: new URL(`${name}.png`, captures).pathname, animations: 'disabled' });
}

for (const variant of [
  { name: 'wide-light', width: 1440, height: 900, theme: 'light', locale: 'en', docked: false },
  { name: 'compact-dark', width: 960, height: 600, theme: 'dark', locale: 'en', docked: false },
  { name: 'dock-pseudo', width: 1440, height: 900, theme: 'dark', locale: 'en-XA', docked: true },
] as const) {
  test(`nine captures and three frame reviews stay compact (${variant.name})`, async ({ page }, info) => {
    const problems = await watchProblems(page);
    await page.setViewportSize(variant);
    await preferences(page, variant);
    await fakeChat(page, { speed: 0, latencyMs: 0, holdAfter: 'agent.toolStarted:12' });
    const composer = await ask(page, variant.docked);
    await expect(page.getByText(FRAME_INSPECTION_INTRO, { exact: true })).toBeVisible();
    await expect(toggle(page)).toHaveCount(1);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(activity(page).locator('[data-slot=tool-group]')).toHaveCount(2);
    await expect(activity(page).locator('[data-tool="timeline.captureFrame"]')).toHaveAttribute(
      'data-count',
      '9',
    );
    await expect(activity(page).locator('[data-tool="vision.describeFrame"]')).toHaveAttribute(
      'data-count',
      '3',
    );
    await expect(activity(page).locator('[data-slot=tool-run]')).toHaveCount(0);
    await expect(page.locator('[data-role=agent][data-streaming]')).toHaveCount(0);
    await expect(page.locator('[data-slot=run-live-preview]')).toHaveCount(0);
    await expect(composer).toBeInViewport();
    await capture(page, `${variant.name}-working`);
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(activity(page).locator('[data-step-status]')).toHaveCount(3);
    await expect(activity(page).locator('[data-slot=tool-summary]')).toHaveCount(0);
    await expect(activity(page).locator('button[aria-expanded]')).toHaveCount(0);
    await expectAccessible(page, info, `streaming activity ${variant.name}`);
    await capture(page, `${variant.name}-expanded`);
    await page.keyboard.press('Space');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle(page)).toBeFocused();
    expect(problems).toEqual([]);
  });
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`real reasoning appears while its chunks arrive (${reducedMotion})`, async ({ page }, info) => {
    await page.setViewportSize({ width: 960, height: 600 });
    await preferences(page, { theme: 'light', locale: 'en' });
    await page.emulateMedia({ reducedMotion });
    await fakeChat(page, { speed: 0, latencyMs: 0, holdAfter: 'agent.reasoningDelta:11' });
    await ask(page);
    const preview = page.locator('[data-slot=run-live-preview]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('comparing');
    await expect(toggle(page)).toHaveAccessibleName('Activity · Thinking…');
    await expect(preview.locator('a, button, [tabindex]')).toHaveCount(0);
    await expect(page.locator('[data-role=agent][data-streaming]')).toHaveCount(0);
    await expect(page.locator('[data-slot=chat-working]')).toHaveText('');
    if (reducedMotion === 'no-preference') {
      const runningLoops = () =>
        page
          .locator('[data-slot=run-block]')
          .evaluate(
            (el) =>
              el
                .getAnimations({ subtree: true })
                .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
                .length,
          );
      await expect.poll(runningLoops).toBeGreaterThan(0);
      // Audit the breathing label at its lowest opacity, not just the bright part of the cycle.
      await page.locator('[data-slot=run-block]').evaluate((el) => {
        for (const animation of el.getAnimations({ subtree: true })) {
          if (animation.effect?.getTiming().iterations !== Infinity) continue;
          animation.pause();
          animation.currentTime = 0;
        }
      });
    }
    await expectAccessible(page, info, `real reasoning ${reducedMotion}`);
    if (reducedMotion === 'reduce') {
      expect(
        await page
          .locator('[data-slot=run-block]')
          .evaluate(
            (el) =>
              el
                .getAnimations({ subtree: true })
                .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
                .length,
          ),
      ).toBe(0);
    }
    await capture(page, `thinking-${reducedMotion}`);
    await toggle(page).click();
    await expect(preview).toHaveCount(0);
    await expect(activity(page).locator('[data-activity-note=reasoning]')).toContainText('comparing');
  });
}

test('public narration streams as received without a fabricated thinking preview', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakeChat(page, { speed: 0, latencyMs: 0, holdAfter: 'agent.messageDelta:2' });
  await ask(page);
  const message = page.locator('[data-role=agent][data-streaming]');
  await expect(message).toHaveCount(1);
  await expect(message).toHaveAttribute('aria-busy', 'true');
  await expect(message).not.toContainText(FRAME_INSPECTION_INTRO);
  await expect(page.locator('[data-slot=run-live-preview]')).toHaveCount(0);
});

test('finished work leads with the answer and retains real findings in activity', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakeChat(page, { speed: 0, latencyMs: 0 });
  await ask(page);
  await expect(page.getByText(FRAME_INSPECTION_ANSWER, { exact: true })).toBeVisible();
  await expect(page.locator('[data-role=agent][data-streaming]')).toHaveCount(0);
  await expect(page.locator('[data-slot=run-live-preview]')).toHaveCount(0);
  await expect(toggle(page)).toHaveAccessibleName('Activity');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await capture(page, 'finished');
  await toggle(page).click();
  await expect(activity(page).locator('[data-slot=tool-summary]')).toHaveCount(3);
  await expect(activity(page)).toContainText('Closing frame: pink reflection in the dark sky.');
  await expectAccessible(page, info, 'finished frame inspection');
  await capture(page, 'finished-expanded');
});
