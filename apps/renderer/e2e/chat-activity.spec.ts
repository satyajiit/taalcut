// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, test, type Locator } from '@playwright/test';
import { expectAccessible } from './axe';
import { PROJECT } from './routes';
import { fakeChat, preferences } from './support';

// Hidden persisted examples from chat/fake-workspace-script.ts; no production data or network is needed.
const WORKSPACE_CHAT = '01K7C5M6Q8R9S0T1V2W3X4C501';
const WORKSPACE_FAILED_CHAT = '01K7C5M6Q8R9S0T1V2W3X4C502';
const WORKSPACE_PROMPT = 'Is 100757.mp4 a good closing shot?';
const WORKSPACE_ANSWER =
  '100757.mp4 is 17 seconds long. Its steady final frame makes a calm closing shot. Use the last few seconds to give the ending room to breathe.';

async function expectQuietResult(transcript: Locator) {
  const answer = transcript.getByText(WORKSPACE_ANSWER, { exact: true });
  await expect(answer).toBeVisible();
  const toggle = transcript.locator('[data-slot=run-activity-toggle]');
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const region = transcript.locator('[data-slot=run-activity]');
  await expect(region).toHaveAttribute('aria-hidden', 'true');
  await expect(region).toHaveAttribute('inert', '');
  expect(
    await transcript.evaluate((element, text) => {
      const result = [...element.querySelectorAll('[data-item=agent]')].find((row) =>
        row.textContent?.includes(text),
      );
      const activity = element.querySelector('[data-slot=run-activity-toggle]');
      return (
        !!result &&
        !!activity &&
        Boolean(result.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }, WORKSPACE_ANSWER),
  ).toBe(true);
  await expect(transcript.locator('[data-slot=tool-run]:not([data-slot=run-activity] *)')).toHaveCount(0);
  return { toggle, region };
}

for (const variant of [
  { name: 'light', theme: 'light', locale: 'en', reducedMotion: 'no-preference' },
  { name: 'dark-reduced', theme: 'dark', locale: 'en', reducedMotion: 'reduce' },
  { name: 'pseudo', theme: 'dark', locale: 'en-XA', reducedMotion: 'reduce' },
] as const) {
  test(`saved closing-shot result has one keyboard-accessible activity summary (${variant.name})`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 960, height: 600 });
    await preferences(page, variant);
    await page.emulateMedia({ reducedMotion: variant.reducedMotion });
    await page.goto(`/chat/${WORKSPACE_CHAT}`);
    const transcript = page.locator('[data-slot=transcript]');
    const { toggle, region } = await expectQuietResult(transcript);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(region.locator('[data-slot=tool-run]')).toHaveCount(0);
    await expect(region.locator('[data-slot=tool-group]')).toHaveCount(1);
    await expect(region.locator('[data-slot=tool-group]')).toHaveAttribute('data-count', '2');
    await expect(region.locator('[data-slot=tool-summary]')).toHaveCount(2);
    await expect(region).toContainText('ffprobe 100757.mp4 · exit 0 · duration=17.000000');
    await expect(region).toContainText('inspect final frame · exit 0 · closing-shot-inspection.json saved');
    await expect(region.locator('details, button[aria-expanded]')).toHaveCount(0);
    await expectAccessible(page, info, `closing-shot activity ${variant.name}`);
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await page.reload();
    await expectQuietResult(transcript);
  });
}

for (const docked of [false, true]) {
  test(`a live closing-shot result settles like history (${docked ? 'editor dock' : 'standalone'})`, async ({
    page,
  }) => {
    await preferences(page, { locale: 'en', theme: 'light' });
    await fakeChat(page, { speed: 0, latencyMs: 0 });
    await page.goto(docked ? `/projects/${PROJECT}/timeline` : '/chat');
    const surface = docked ? page.locator('[data-slot=editor-dock]') : page.locator('main');
    const composer = surface.getByRole('textbox', { name: 'Message Taalcut' });
    await composer.fill(WORKSPACE_PROMPT);
    await composer.press('Enter');
    await expectQuietResult(surface.locator('[data-slot=transcript]'));
    await expect(composer).toBeInViewport();
  });
}

test('active work and failed retries stay reachable without opening diagnostics', async ({ page }) => {
  await preferences(page, { locale: 'en', theme: 'light' });
  await fakeChat(page, { speed: 0, latencyMs: 0, holdAfter: 'agent.toolStarted' });
  await page.goto('/chat');
  const composer = page.getByRole('textbox', { name: 'Message Taalcut' });
  await composer.fill(WORKSPACE_PROMPT);
  await composer.press('Enter');
  await expect(page.locator('[data-slot=run-activity-toggle]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(page.getByText(WORKSPACE_ANSWER, { exact: true })).toHaveCount(0);
  await page.goto(`/chat/${WORKSPACE_FAILED_CHAT}`);
  const activity = page.locator('[data-slot=run-activity]');
  await expect(activity).toHaveAttribute('aria-hidden', 'true');
  const failure = page.locator('[data-slot=tool-run][data-status=failed]');
  await expect(failure).toBeVisible();
  await expect(failure.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(1);
  await expect(page.locator('[data-slot=run-activity-toggle]')).toHaveCount(1);
  await expect(page.locator('[data-slot=transcript] > [data-item=agent]')).toHaveCount(1);
  expect(await failure.evaluate((element) => element.closest('[data-slot=run-activity]') === null)).toBe(
    true,
  );
  await expect(failure).toContainText('This took too long');
});
