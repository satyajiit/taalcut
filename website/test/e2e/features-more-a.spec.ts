// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';

/**
 * WEB3 lane A: Bring your footage in (/features/import/) and Shorts from long videos (/features/shorts/). Each page's
 * showcase renders in the app window and in the server's HTML, works by keyboard and touch, fits a 320 px phone, and
 * under reduced motion shows its finished state at once. The index's fragments work too.
 */

const showcase = (page: Page, slug: string) => page.locator(`[data-showcase="${slug}"]`);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('import: the ways in, the phone’s question and the clips at their stages are in the HTML', async ({ page }) => {
    await page.goto('/features/import/');
    const plate = showcase(page, 'import');
    await expect(page.getByRole('group', { name: /^A demonstration of the Taalcut app: Library › Import/ }).locator('[data-showcase="import"]')).toHaveCount(1);
    for (const words of ['Phone over Wi-Fi', 'Phone on a cable', 'Insta360', 'Apple Photos', 'Scan the code with your phone', 'Allow iPhone to send videos?', 'Connected over your Wi-Fi', 'Arriving in your library', 'Available to edit', 'Searchable', 'Fully analysed']) {
      await expect(plate).toContainText(words);
    }
    await expect(plate.locator('[data-stage]')).toHaveCount(4);
    await expect(page.getByRole('group', { name: 'Your phone’s browser, open on Taalcut’s page' })).toContainText('Choose from Files');
    await expect(page.getByRole('region', { name: 'What it does' }).locator('[data-slot="vignette"]')).toHaveCount(4);
  });

  test('shorts: the dialog, the marked long video, the short and its check are in the HTML', async ({ page }) => {
    await page.goto('/features/shorts/');
    const plate = showcase(page, 'shorts');
    for (const words of ['Make a short', 'Turn one long video into a portrait story with captions and your branding.', 'Target length', '60 sec', 'Create short', 'Your short', 'Checked against the original frames', 'Smart reframe']) {
      await expect(plate).toContainText(words);
    }
    await expect(plate.locator('[data-part="hook"]')).toHaveCount(1);
    await expect(plate.locator('[data-part="payoff"]')).toHaveCount(1);
    await expect(plate.locator('[data-check="passed"]')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'What it does' }).locator('[data-slot="vignette"]')).toHaveCount(4);
  });

  test('the index shows both fragments', async ({ page }) => {
    await page.goto('/features/');
    await expect(page.locator('[data-feature="import"] [data-showcase="import-fragment"]')).toContainText('Arriving in your library');
    await expect(page.locator('[data-feature="shorts"] [data-showcase="shorts-fragment"]')).toContainText('Target length');
  });
});

test.describe('by keyboard', () => {
  test('import: Ubuntu offers three ways in; a watched folder keeps footage in place', async ({ page }) => {
    await page.goto('/features/import/');
    const plate = showcase(page, 'import');
    const window = page.locator('[data-slot="app-window"]').filter({ has: plate });
    await page.getByRole('radio', { name: 'Mac' }).first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Ubuntu' }).first()).toHaveAttribute('aria-checked', 'true');
    await expect(window).toHaveAttribute('data-platform', 'ubuntu');
    await expect(plate.locator('[data-way]')).toHaveCount(3);
    await expect(plate).toContainText('On a Mac, also Apple Photos, Phone on a cable, Camera or card, DJI and Insta360.');
    await page.keyboard.press('ArrowLeft');
    await expect(window).toHaveAttribute('data-platform', 'mac');
    await expect(plate.locator('[data-way]')).toHaveCount(8);

    await plate.getByRole('button', { name: 'Folder' }).focus();
    await page.keyboard.press('Enter');
    await expect(plate.getByRole('button', { name: 'Folder' })).toHaveAttribute('aria-pressed', 'true');
    await expect(plate.locator('[data-way-page="folder"]')).toBeVisible();
    await plate.getByRole('checkbox', { name: 'Watch for new footage' }).focus();
    await page.keyboard.press('Space');
    await expect(plate.getByRole('radio', { name: /Keep in place/ })).toBeChecked();
    await expect(plate.getByRole('radio', { name: /Keep in place/ })).toBeDisabled();
    await expect(plate).toContainText('Watching for new footage');
    await expect(plate).toContainText('New');
    await page.keyboard.press('Space');
    await expect(plate.getByRole('radio', { name: /Copy into Taalcut/ })).toBeChecked();
  });

  test('import: the phone asks, Allow lets it in, and Choose from Files sends two more clips', async ({ page }) => {
    await page.goto('/features/import/');
    const plate = showcase(page, 'import');
    const question = plate.locator('[data-slot="approval"]');
    const phone = page.getByRole('group', { name: 'Your phone’s browser, open on Taalcut’s page' });
    await question.scrollIntoViewIfNeeded();
    await expect(question).toHaveAttribute('data-answer', 'allowed', { timeout: 8000 });
    await expect(plate.locator('[data-stage]')).toHaveCount(4, { timeout: 8000 });

    await plate.getByRole('button', { name: 'Replay' }).focus();
    await page.keyboard.press('Enter');
    await expect(question).toHaveAttribute('data-answer', 'asking');
    await expect(phone).toContainText('Waiting for approval on your computer…');
    await question.getByRole('button', { name: 'Deny' }).focus();
    await page.keyboard.press('Enter');
    await expect(question).toHaveAttribute('data-answer', 'denied');
    await expect(phone).toContainText('Your computer said no.');
    await phone.getByRole('button', { name: 'Ask again' }).focus();
    await page.keyboard.press('Enter');
    await expect(question).toHaveAttribute('data-answer', 'asking');
    await question.getByRole('button', { name: 'Allow' }).focus();
    await page.keyboard.press('Enter');
    await expect(question).toHaveAttribute('data-answer', 'allowed');
    await expect(plate.locator('[data-stage]')).toHaveCount(4, { timeout: 8000 });

    await phone.getByRole('button', { name: /Choose from Files/ }).focus();
    await page.keyboard.press('Enter');
    await expect(plate.getByRole('region', { name: 'Arriving in your library' })).toContainText('6 clips', { timeout: 5000 });
    await expect(phone).toContainText(/\d of 6 added/);
    await expect(plate.locator('[data-stage="4"]').first()).toBeVisible({ timeout: 8000 });
  });

  test('shorts: a 30 sec short, a custom length the app refuses, then one it takes; Cancel and back', async ({ page }) => {
    await page.goto('/features/shorts/');
    const plate = showcase(page, 'shorts');
    await plate.scrollIntoViewIfNeeded();
    await expect(plate.locator('[data-check="passed"]')).toHaveCount(1, { timeout: 8000 });
    const dialog = plate.locator('[data-slot="make-short"]');
    await dialog.getByRole('radio', { name: '60 sec' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.getByRole('radio', { name: '30 sec' })).toHaveAttribute('aria-checked', 'true');
    await dialog.getByRole('button', { name: 'Create short' }).focus();
    await page.keyboard.press('Enter');
    await expect(plate.locator('[data-check="passed"]')).toHaveCount(1, { timeout: 8000 });
    await expect(plate.locator('[data-part]')).toHaveCount(4);
    await expect(plate).toContainText('0:28');

    await dialog.getByRole('radio', { name: '30 sec' }).focus();
    await page.keyboard.press('End');
    await expect(dialog.getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true');
    const seconds = dialog.getByRole('spinbutton', { name: 'Length in seconds' });
    await seconds.fill('200');
    await expect(dialog.getByRole('alert')).toHaveText('Choose a whole number from 15 to 179 seconds.');
    await expect(dialog.getByRole('button', { name: 'Create short' })).toBeDisabled();
    await seconds.fill('15');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Create short' }).focus();
    await page.keyboard.press('Enter');
    await expect(plate.locator('[data-check="passed"]')).toHaveCount(1, { timeout: 8000 });
    await expect(plate.locator('[data-part]')).toHaveCount(2);

    await plate.locator('[data-line="l1"]').focus();
    await expect(plate).toContainText('“Six in the morning, and we’re already at the airport.” Hook, 0:00 to 1:23 of the long video.');

    await dialog.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('Enter');
    await expect(plate.locator('[data-slot="make-short"]')).toHaveCount(0);
    const opener = plate.getByRole('button', { name: 'Make a short' });
    await expect(opener).toBeFocused();
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(plate.locator('[data-slot="make-short"]')).toBeVisible();
  });

  test('the index: the import fragment switches platform and the shorts fragment re-marks for 90 sec', async ({ page }) => {
    await page.goto('/features/');
    const imports = showcase(page, 'import-fragment');
    await imports.scrollIntoViewIfNeeded();
    const window = page.locator('[data-slot="app-window"]').filter({ has: imports });
    await window.getByRole('radio', { name: 'Ubuntu' }).click();
    await expect(imports.locator('[data-way]')).toHaveCount(3);
    const shorts = showcase(page, 'shorts-fragment');
    await shorts.scrollIntoViewIfNeeded();
    await shorts.getByRole('radio', { name: '90 sec' }).focus();
    await page.keyboard.press('Enter');
    await expect(shorts.getByRole('radio', { name: '90 sec' })).toHaveAttribute('aria-checked', 'true');
    await expect(shorts).toContainText('1:22: the hook, 10 sentences of context and the payoff.', { timeout: 8000 });
  });
});

test.describe('by touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('import: tap Choose from Photos on the phone, and its clips arrive', async ({ page }) => {
    await page.goto('/features/import/');
    const plate = showcase(page, 'import');
    const phone = page.getByRole('group', { name: 'Your phone’s browser, open on Taalcut’s page' });
    await plate.locator('[data-slot="approval"]').scrollIntoViewIfNeeded();
    await expect(plate.locator('[data-slot="approval"]')).toHaveAttribute('data-answer', 'allowed', { timeout: 8000 });
    await phone.scrollIntoViewIfNeeded();
    await phone.getByRole('button', { name: /Choose from Photos/ }).tap();
    await expect(plate.getByRole('region', { name: 'Arriving in your library' })).toContainText('6 clips', { timeout: 6000 });
  });

  test('shorts: tap a part to play from it', async ({ page }) => {
    await page.goto('/features/shorts/');
    const plate = showcase(page, 'shorts');
    await plate.scrollIntoViewIfNeeded();
    await expect(plate.locator('[data-check="passed"]')).toHaveCount(1, { timeout: 8000 });
    await plate.locator('[data-part="payoff"]').tap();
    await expect(plate.locator('[data-part="payoff"]')).toHaveAttribute('aria-current', 'true');
  });
});

for (const width of [320, 375]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 760 } });

    for (const path of ['/features/import/', '/features/shorts/']) {
      test(`${path} has no sideways scroll`, async ({ page }) => {
        await page.goto(path);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      });
    }
  });
}

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('import shows the finished run at once, and sending more lands at once', async ({ page }) => {
    await page.goto('/features/import/');
    const plate = showcase(page, 'import');
    await plate.locator('[data-slot="approval"]').scrollIntoViewIfNeeded();
    await expect(plate.locator('[data-run]')).toHaveAttribute('data-run', 'reduced');
    await expect(plate.locator('[data-slot="approval"]')).toHaveAttribute('data-answer', 'allowed');
    await expect(plate.locator('[data-stage]')).toHaveCount(4);
    await expect(plate.locator('[data-ghost]')).toHaveCount(0);
    await page.getByRole('button', { name: /Choose from Files/ }).click();
    await expect(plate.locator('[data-stage="4"]')).toHaveCount(4);
  });

  test('shorts shows the made short at once, and the preview waits for Play', async ({ page }) => {
    await page.goto('/features/shorts/');
    const plate = showcase(page, 'shorts');
    await plate.scrollIntoViewIfNeeded();
    await expect(plate.locator('[data-run]')).toHaveAttribute('data-run', 'reduced');
    await expect(plate.locator('[data-check="passed"]')).toHaveCount(1);
    await expect(plate.getByRole('button', { name: 'Play' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(plate.getByRole('button', { name: 'Play' })).toBeVisible();
    await plate.getByRole('radio', { name: '90 sec' }).click();
    await plate.getByRole('button', { name: 'Create short' }).click();
    await expect(plate.locator('[data-check="passed"]')).toHaveCount(1);
    await expect(plate.locator('[data-part]')).toHaveCount(12);
  });
});
