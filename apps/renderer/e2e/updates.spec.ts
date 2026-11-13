// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B9, P3-B14 (the window's part): Settings › General › Updates (its own page since UX4, About before it) says
// what the updater is doing in each state; Beta needs the
// beta terms first; the update dialog shows the release's notes as text, is keyboard-complete, opens by itself only
// on the launch after a Later; accessible in light and dark, clean in the pseudo-locale. Undoing the first choice
// goes back to the build's own channel (round P3-3: setChannel(null) is the inverse, no restoreChannel).
import { expect, test, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { open, preferences } from './support.ts';
import {
  expectAccessible,
  expectPseudoClean,
  fakes,
  fakeState,
  shoot,
  type Ui2bFakeOptions,
} from './ui2b-support.ts';
import { fakeCall } from './wire-watch.ts';

const UPDATES = { name: 'settings-updates', path: '/settings/updates' };

/** The Updates page, opened afresh with these fakes: the whole page is about updates now, so its main is the scope. */
async function about(page: Page, options: Ui2bFakeOptions, theme: 'light' | 'dark' = 'light') {
  await preferences(page, { theme, locale: 'en' });
  await fakes(page, options);
  await open(page, UPDATES);
  await expect(page.locator('[data-slot=update-status]')).toBeVisible();
  return page.getByRole('main');
}

for (const theme of ['light', 'dark'] as const) {
  test(`Updates and the dialog in ${theme}: accessible, as designed`, async ({ page }, testInfo) => {
    const updates = await about(page, { channel: 'beta', update: 'ready' }, theme);
    await expect(updates.getByText('Taalcut 0.3.0-beta.3 is ready')).toBeVisible();
    await expectAccessible(page, testInfo, `about updates (${theme})`);
    await shoot(page, `updates-about-ready-${theme}`);
    await updates.getByRole('button', { name: 'See what’s new' }).click();
    const dialog = page.getByRole('dialog', { name: 'Taalcut 0.3.0-beta.3 is ready' });
    await expect(dialog).toBeVisible();
    await expectAccessible(page, testInfo, `update dialog (${theme})`);
    await shoot(page, `updates-dialog-${theme}`);
  });

  test(`choosing Beta shows the beta terms in ${theme}`, async ({ page }, testInfo) => {
    const updates = await about(page, { channel: 'stable' }, theme);
    await updates.getByRole('radio', { name: /Beta/ }).check();
    await expect(updates.getByRole('button', { name: 'Agree and switch to Beta' })).toBeVisible();
    await expectAccessible(page, testInfo, `beta terms (${theme})`);
    await shoot(page, `updates-beta-terms-${theme}`);
  });
}

test('each updater state says what is happening', async ({ page }) => {
  let updates = await about(page, { channel: 'stable', update: 'idle' });
  await expect(updates.getByText('Taalcut is up to date')).toBeVisible();
  await updates.getByRole('button', { name: 'Check now' }).click();
  await expect(updates.getByText('Taalcut is up to date')).toBeVisible();

  updates = await about(page, { channel: 'beta', update: 'downloading' });
  await expect(updates.getByText('Downloading Taalcut 0.3.0-beta.3')).toBeVisible();
  await expect(updates.getByRole('progressbar', { name: 'Update download' })).toHaveAttribute(
    'aria-valuenow',
    '42',
  );

  await about(page, { channel: 'beta', update: 'rolled-back' });
  await expect(page.locator('#updates').getByRole('status')).toHaveText(
    'The update to 0.3.0-beta.3 didn’t start, so Taalcut went back to 0.3.0-beta.2. Nothing was lost.',
  );

  updates = await about(page, { channel: 'beta', update: 'ready' });
  await expect(updates.getByRole('button', { name: 'See what’s new' })).toBeVisible();
});

test('Beta records the beta terms, then switches as the person', async ({ page }) => {
  const updates = await about(page, { channel: 'stable' });
  await updates.getByRole('radio', { name: /Beta/ }).check();
  await expect(updates.getByText('Things can still break. Your clips stay on this Mac.')).toBeVisible();
  await updates.getByRole('button', { name: 'Agree and switch to Beta' }).click();
  await expect(updates.getByRole('button', { name: 'Agree and switch to Beta' })).toHaveCount(0);
  await expect(updates.getByRole('radio', { name: /Beta/ })).toBeChecked();
  expect(await backend.dispatched(page)).toContainEqual({ name: 'updates.setChannel', source: 'ui' });
});

test('undoing the first choice goes back to the build’s channel; redo chooses again', async ({ page }) => {
  const updates = await about(page, { channel: 'stable' });
  await updates.getByRole('radio', { name: /Beta/ }).check();
  await updates.getByRole('button', { name: 'Agree and switch to Beta' }).click();
  await expect(updates.getByRole('radio', { name: /Beta/ })).toBeChecked();
  // The radio answers at once; the command lands a moment later.
  await expect.poll(() => fakeCall(page, 'phase3.updates.watch.get')).toMatchObject({ choice: 'beta' });

  const undone = await fakeCall(page, 'bus.undo', [null, { source: 'ui', actor: 'user' }]);
  expect(undone).toMatchObject({ ok: true, value: { name: 'updates.setChannel' } });
  await expect(updates.getByRole('radio', { name: /Stable/ })).toBeChecked();
  expect(await fakeCall(page, 'phase3.updates.watch.get')).toMatchObject({
    channel: 'stable',
    choice: 'stable',
  });

  await fakeCall(page, 'bus.redo', [null, { source: 'ui', actor: 'user' }]);
  await expect(updates.getByRole('radio', { name: /Beta/ })).toBeChecked();
});

test('the dialog by keyboard: notes as text, Restart now first, Escape is Later, focus comes back', async ({
  page,
}) => {
  const updates = await about(page, { channel: 'beta', update: 'ready' });
  const opener = updates.getByRole('button', { name: 'See what’s new' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Taalcut 0.3.0-beta.3 is ready' });
  await expect(dialog).toBeVisible();
  const notes = dialog.getByRole('region', { name: 'Release notes' });
  await expect(notes.getByRole('listitem')).toHaveCount(3);
  await expect(notes.locator('strong')).toHaveText('Starter templates');
  await expect(notes).not.toContainText('**');
  await expect(dialog.getByRole('button', { name: 'Restart now' })).toBeFocused();
  // Tab stays inside the dialog and reaches every control.
  const reached = new Set<string>();
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Tab');
    reached.add(
      await page.evaluate(
        () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '',
      ),
    );
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  expect([...reached]).toEqual(expect.arrayContaining(['Release notes', 'Later', 'Restart now', 'Close']));
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Later brings the dialog back once on the next launch; Restart now asks main to install', async ({
  page,
}) => {
  const updates = await about(page, { channel: 'beta', update: 'ready' });
  await updates.getByRole('button', { name: 'See what’s new' }).click();
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Taalcut 0.3.0-beta.3 is ready' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Restart now' }).click();
  await expect.poll(async () => (await fakeState<number[]>(page, 'phase3.updates.installs')).length).toBe(1);
});

test('Updates and the dialog in the pseudo-locale', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en-XA' });
  await fakes(page, { channel: 'stable', update: 'ready' });
  await open(page, UPDATES);
  await expectPseudoClean(page, 'about updates');
  await page.locator('[data-slot=update-status] [data-action=see-whats-new]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectPseudoClean(page, 'update dialog');
  await shoot(page, 'updates-dialog-pseudo');
});
