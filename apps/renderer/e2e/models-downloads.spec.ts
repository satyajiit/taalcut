// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2-DOWNLOADER "Done when" (the window's part, on the fake): first run starts the download of everything this Mac
// needs by itself (UX4: on its first step, shown only as Getting ready in the steps' sidebar) and ends with it still
// downloading; the window bar's ring and Settings › Models › Downloads show it coming in by job until every job is
// Ready; a part whose download fails says why in the component manager's own words, with Try again; the bar's popover
// pauses, resumes and closes with Escape; a disk too full says so with its fix; axe-clean in light and dark; main's
// "couldn't download" notification, clicked, opens Settings › Models › Downloads on the job's row. The fake backend
// lives in the page, so the run moves between screens with the app's own links, never a reload (a reload would start
// a fresh fake).
import { expect, test, type Page } from '@playwright/test';
import { DOWNLOADS_SHOW_ACTION } from '@taalcut/core';
import { preferences } from './support.ts';
import { action, atStep, expectDispatched } from './onboarding-support.ts';

const gettingReady = (page: Page) => page.locator('[data-slot=getting-ready]');
import { expectAccessible, fakes, shoot } from './ui2b-support.ts';

const section = (page: Page) => page.getByRole('region', { name: 'Models for this Mac' });
const job = (page: Page, key: string) => section(page).locator(`li[data-job="${key}"]`);
const indicator = (page: Page) => page.locator('[data-slot=downloads-indicator]');

/** What main does when the person clicks its "couldn't download" notification: a `ui.action` to the page. */
async function notificationClicked(page: Page, job: string): Promise<void> {
  await page.evaluate(
    ([action, named]) => {
      const fake: unknown = Reflect.get(window, 'taalcutFake');
      const events: unknown =
        typeof fake === 'object' && fake !== null ? Reflect.get(fake, 'events') : undefined;
      const emit: unknown =
        typeof events === 'object' && events !== null ? Reflect.get(events, 'emit') : undefined;
      if (typeof emit !== 'function') throw new Error('no fake backend in the page');
      Reflect.apply(emit, events, ['ui.action', { action, args: { job: named } }]);
    },
    [DOWNLOADS_SHOW_ACTION, job] as const,
  );
}

/** Settings, then Models' Downloads view (UX4: the downloads are a view of Models of their own), by the app's links. */
async function toSettings(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Models' }).click();
  await page
    .locator('[data-slot=settings-views]')
    .getByRole('link', { name: 'Downloads', exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/models\/downloads$/);
  await expect(section(page)).toBeVisible();
}
const DOWNLOADS = '/settings/models/downloads';

test('first run starts everything this Mac needs, and the bar and Models › Downloads show it coming in', async ({
  page,
}, testInfo) => {
  // It watches a whole download, every tick in real time, so it can see it coming in on three screens: about 27 s
  // alone, where the default 30 s leaves no room on a busy Mac (it ran out at load 30–46 in rounds 2 and 3).
  test.slow();
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { onboarding: 'fresh', channel: 'stable', library: 'empty', downloadTickMs: 500 });
  await page.goto('/onboarding');
  await action(page, 'get-started').click();
  await atStep(page, 'sources');
  // It starts by itself on the first step: no picks, everything is needed, and nothing to read about it. The
  // steps' sidebar keeps it in view.
  await expectDispatched(page, 'components.download');
  await expect(gettingReady(page)).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  await shoot(page, 'downloads-first-run-light');
  await expectAccessible(page, testInfo, 'first run, downloading (light)');

  // First run ends while it downloads; the window bar keeps it in view.
  await action(page, 'skip').click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(indicator(page)).toHaveAttribute('data-state', 'downloading');
  await expect(page.getByRole('button', { name: /^Downloading models, \d+%$/ })).toBeVisible();

  await toSettings(page);
  await expect(section(page).locator('[data-slot=downloads-summary]')).toContainText(/ of /);
  await shoot(page, 'downloads-settings-downloading-light');
  await expectAccessible(page, testInfo, 'settings models, downloading (light)');

  await expect(section(page).locator('[data-slot=downloads-summary]')).toHaveAttribute(
    'data-state',
    'ready',
    {
      timeout: 60_000,
    },
  );
  for (const key of ['speech', 'search', 'text', 'shots', 'beats', 'writing', 'titles', 'sounds'])
    await expect(job(page, key)).toHaveAttribute('data-state', 'ready');
  // It finished in front of you: the bar's mark says so, then goes.
  await expect(page.getByRole('button', { name: 'Models downloaded' })).toBeVisible();
  await expect(indicator(page)).toHaveCount(0, { timeout: 8000 });
});

for (const theme of ['light', 'dark'] as const) {
  test(`Models › Downloads: Download fetches what's missing; a failed part says why (${theme})`, async ({
    page,
  }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    await fakes(page, { models: 'broken', downloadTickMs: 120 });
    await page.goto(DOWNLOADS);
    await expect(job(page, 'speech')).toHaveAttribute('data-state', 'missing');
    await expect(job(page, 'speech')).toContainText('Whisper tiny');
    await shoot(page, `downloads-settings-missing-${theme}`);
    await expectAccessible(page, testInfo, `settings models, missing (${theme})`);

    await action(page, 'download-models').click();
    await expect(job(page, 'search')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await expect(job(page, 'speech')).toHaveAttribute('data-state', 'failed');
    await expect(job(page, 'speech').getByRole('alert')).toContainText(
      'The server sent a different file for Whisper tiny. Try again later.',
    );
    await expect(job(page, 'speech')).toContainText('Didn’t download');
    await expect(action(page, 'retry-downloads')).toBeVisible();
    await shoot(page, `downloads-settings-failed-${theme}`);
    await expectAccessible(page, testInfo, `settings models, failed (${theme})`);
  });

  test(`the window bar's popover shows the download and pauses it (${theme})`, async ({ page }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    await fakes(page, { downloads: 'midway', downloadTickMs: 600_000 });
    await page.goto('/library');
    const button = page.getByRole('button', { name: /^Downloading models, \d+%$/ });
    await button.click();
    const popover = page.getByRole('dialog', { name: 'Models for this Mac' });
    await expect(popover).toBeVisible();
    await expect(popover.locator('li[data-job="beats"]')).toContainText(/Reconnecting in \d+ s/);
    await shoot(page, `downloads-popover-${theme}`);
    await expectAccessible(page, testInfo, `downloads popover (${theme})`);

    await popover.locator('[data-action=pause-downloads]').click();
    await expect(popover.locator('[data-slot=downloads-summary]')).toHaveAttribute('data-state', 'paused');
    await expect(page.getByRole('button', { name: /^Model downloads paused at \d+%$/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(page.getByRole('button', { name: /^Model downloads paused at \d+%$/ })).toBeFocused();
  });
}

test('a disk too full says so on first run, with its fix', async ({ page }, testInfo) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  // Something can think (Local only), so the download is what the last step's moment is about.
  await fakes(page, {
    onboarding: 'fresh',
    channel: 'stable',
    library: 'empty',
    freeDiskGb: 2,
    localOnly: true,
  });
  await page.goto('/onboarding/first-video');
  await atStep(page, 'first-video');
  await expect(page.locator('[data-slot=quiet-check][data-need=download]')).toBeVisible();
  await action(page, 'quiet-check-open').click();
  const problems = section(page).locator('[data-slot=downloads-problems]');
  await expect(problems).toContainText('The models this Mac needs don’t fit on its disk.');
  await expect(problems.getByRole('button', { name: 'Open Storage Settings' })).toBeVisible();
  await expect(action(page, 'retry-downloads')).toBeVisible();
  await shoot(page, 'downloads-space-low-light');
  await expectAccessible(page, testInfo, 'first run, not enough space (light)');
});

test('main’s “couldn’t download” notification, clicked, opens Models › Downloads on that job’s row', async ({
  page,
}, testInfo) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { models: 'broken', downloadTickMs: 120 });
  await page.goto(DOWNLOADS);
  await action(page, 'download-models').click();
  // It stops with Speech's part failed: main posts the notification then (downloads-notify.ts).
  await expect(section(page).locator('[data-slot=downloads-summary]')).toHaveAttribute(
    'data-state',
    'failed',
    {
      timeout: 20_000,
    },
  );
  // The person has gone on elsewhere; they click the notification.
  await page.getByRole('link', { name: 'Back to app' }).click();
  await expect(page).not.toHaveURL(/\/settings\//);
  // The palette's listener may still be on its way: sent until it lands.
  await expect(async () => {
    await notificationClicked(page, 'speech');
    // The notification names Models' address; the download lives on its Downloads view, which keeps the hash.
    await expect(page).toHaveURL(/\/settings\/models\/downloads#downloads-speech$/, { timeout: 500 });
  }).toPass();
  await expect(job(page, 'speech')).toBeFocused();
  await expect(job(page, 'speech').getByRole('alert')).toContainText('Whisper tiny');
  await expect(job(page, 'speech')).toBeInViewport();
  // The focus ring says which row it is, until focus moves on; the other rows can't take focus.
  await expect(job(page, 'speech')).toHaveCSS('outline-style', 'solid');
  await expect(job(page, 'search')).not.toHaveAttribute('tabindex');
  await shoot(page, 'downloads-notification-landing-light');
  await expectAccessible(page, testInfo, 'settings models, opened from the notification (light)');
});
