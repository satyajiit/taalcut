// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, type Page, test } from '@playwright/test';

/** Lane L6's pages at work: the FAQ's search and accordion, the /ai/ demos, the press kit's copy, and reflow. */

const OWN = ['/ai/', '/faq/', '/about/', '/press/', '/privacy/', '/terms/', '/beta-terms/', '/no-such-page/'] as const;

const questions = (page: Page) => page.locator('[data-slot="faq-question"]');

/** The FAQ has hydrated once its closed answers carry hidden="until-found" (set by an effect). */
async function openFaq(page: Page, path = '/faq/') {
  await page.goto(path);
  await page.locator('[data-faq-answer][hidden="until-found"]').first().waitFor({ state: 'attached' });
}

test.describe('the FAQ', () => {
  test('search filters the questions as you type, marks the words and says how many match', async ({ page }) => {
    await openFaq(page);
    const total = await questions(page).count();
    expect(total).toBeGreaterThan(10);
    const search = page.getByRole('searchbox', { name: 'Search the questions' });
    await search.fill('phone');
    await expect(page.getByRole('status').filter({ hasText: /match(es)? “phone”/ })).toBeVisible();
    const left = await questions(page).count();
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(total);
    await expect(page.locator('mark').first()).toHaveText(/phone/i);
    // A group with nothing left goes, and its topic is no longer a link.
    await expect(page.locator('#group-your-ai')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Topics' }).getByRole('link', { name: /Your AI/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear the search' }).click();
    await expect(questions(page)).toHaveCount(total);
    await expect(search).toBeFocused();
  });

  test('a search with no match says so and clears back to every question', async ({ page }) => {
    await openFaq(page);
    const total = await questions(page).count();
    const search = page.getByRole('searchbox', { name: 'Search the questions' });
    await search.fill('zzqx');
    await expect(page.getByText('No question matches “zzqx”.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'contact page' })).toBeVisible();
    await page.getByRole('group', { name: 'No match' }).getByRole('button', { name: 'Clear the search' }).click();
    await expect(questions(page)).toHaveCount(total);
    await search.fill('zzqx');
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(questions(page)).toHaveCount(total);
  });

  test('the accordion works by keyboard: Enter and Space toggle, arrows, Home and End move', async ({ page }) => {
    await openFaq(page);
    const first = questions(page).first();
    await first.focus();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#what-is-taalcut-a')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#what-is-taalcut-a')).toBeHidden();
    await page.keyboard.press('ArrowDown');
    await expect(questions(page).nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(questions(page).last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    await page.keyboard.press('End');
    await expect(questions(page).last()).toBeFocused();
  });

  test('Open all answers opens every answer, and closes them again', async ({ page }) => {
    await openFaq(page);
    await page.getByRole('button', { name: 'Open all answers' }).click();
    await expect(page.locator('[data-slot="faq-question"][aria-expanded="false"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close all answers' }).click();
    await expect(page.locator('[data-slot="faq-question"][aria-expanded="true"]')).toHaveCount(0);
  });

  test('an anchor opens its answer', async ({ page }) => {
    await page.goto('/faq/#footage-leaves');
    await expect(page.locator('#footage-leaves-q')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#footage-leaves-a')).toBeVisible();
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('every answer shows, and the search, which needs it, hides', async ({ page }) => {
      await page.goto('/faq/');
      await expect(page.locator('#footage-leaves-a')).toBeVisible();
      await expect(page.locator('#when-a')).toBeVisible();
      await expect(page.getByRole('searchbox')).toBeHidden();
    });
  });
});

test.describe('/ai/', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Continue with ChatGPT plays through by its own buttons', async ({ page }) => {
    await page.goto('/ai/');
    const window = page.getByRole('group', { name: 'A demonstration of the Taalcut app: Settings' }).first();
    // Reduced motion shows the finished state: signed in.
    await expect(window.getByText('Using ChatGPT plan')).toBeVisible();
    // Until the page hydrates, Sign out is only drawn; try again until it answers.
    await expect(async () => {
      await window.getByRole('button', { name: 'Sign out' }).click({ timeout: 1000 });
      await expect(window.getByRole('button', { name: 'Continue with ChatGPT' })).toBeVisible({ timeout: 500 });
    }).toPass();
    await window.getByRole('button', { name: 'Continue with ChatGPT' }).click();
    await expect(window.getByText('Waiting for your browser')).toBeVisible();
    await expect(window.getByText('Using ChatGPT plan')).toBeVisible();
    // The segment bar over the window jumps to a step, and the step says its fact beside the window.
    const step = page.getByRole('list', { name: 'The sign-in, step by step' }).getByRole('button', { name: /Sign in/ });
    await step.click();
    await expect(step).toHaveAttribute('aria-current', 'step');
    await expect(page.getByText('Step 2 of 3: Sign in')).toHaveCount(1);
    await expect(page.locator('[data-slot="chatgpt-moment"]').getByText('On OpenAI’s own page, in your browser. Taalcut never sees your password.')).toBeVisible();
  });

  test('the profiles switch by arrow key and Local only works', async ({ page }) => {
    await page.goto('/ai/');
    const everyday = page.getByRole('radio', { name: 'Everyday' });
    await expect(everyday).toHaveAttribute('aria-checked', 'true');
    const best = page.getByRole('radio', { name: 'Best quality' });
    await expect(async () => {
      await everyday.focus();
      await page.keyboard.press('ArrowRight');
      await expect(best).toHaveAttribute('aria-checked', 'true', { timeout: 500 });
    }).toPass();
    await expect(best).toBeFocused();
    const local = page.getByRole('switch', { name: 'Local only' });
    await expect(local).toHaveAttribute('aria-checked', 'false');
    await local.click();
    await expect(local).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Nothing of yours leaves your computer: no cloud models, uploads, reel links, feedback or usage counts.')).toBeVisible();
    // The map walls its border: only the update check still crosses (AI1: the map of what leaves your computer).
    await expect(page.locator('[data-slot="map-lane"][data-crosses="true"]')).toHaveAttribute('data-lane', 'updates');
    await local.press('Space');
    await expect(local).toHaveAttribute('aria-checked', 'false');
  });
});

test('the press kit copies a description and says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/press/');
  const button = page.getByRole('button', { name: /the description in five words/ });
  await expect(async () => {
    await button.click({ timeout: 1000 });
    await expect(button).toHaveText(/Copied/, { timeout: 500 });
  }).toPass();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Make the reel you saved.');
});

for (const width of [390, 320]) {
  test(`L6's pages fit ${width} px all the way down, with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const path of OWN) {
      await page.goto(path);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 600) await page.evaluate((top) => window.scrollTo(0, top), y);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
}
