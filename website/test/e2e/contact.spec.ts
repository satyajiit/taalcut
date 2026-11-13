// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Locator, type Page } from '@playwright/test';
import { contactForm, EMULATOR } from './form-helpers';

/**
 * /contact/ as a direct-message thread: the question sticker and its topic chips, their keys, `?topic=`, the typed
 * opening, the one-line replies, the thread on short screens, Copy, and the page without JavaScript. Runs in any
 * build (what needs the fields open skips while the form is closed); sending (success and failure in the thread) is
 * in contact-send.spec.ts, under the emulator.
 */

const log = (page: Page) => contactForm(page).getByRole('log');
const chip = (page: Page, name: string) => contactForm(page).getByRole('radio', { name });
const answer = (page: Page, field: 'name' | 'email') => log(page).locator(`[data-slot="answer"][data-field="${field}"]`);
const isOpen = async (page: Page) => (await contactForm(page).getAttribute('data-forms')) !== 'closed';

/**
 * Whether an element shows whole once it is scrolled into view: inside the viewport, inside every ancestor that
 * clips, and on top (nothing, the composer or the nav, covers it) along its middle.
 */
async function shownWhole(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const within = (r: DOMRect) =>
      box.top >= r.top - 0.5 && box.bottom <= r.bottom + 0.5 && box.left >= r.left - 0.5 && box.right <= r.right + 0.5;
    const clippedBy: string[] = [];
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const style = getComputedStyle(n);
      if ((style.overflowX !== 'visible' || style.overflowY !== 'visible') && !within(n.getBoundingClientRect()))
        clippedBy.push(`${n.tagName.toLowerCase()}.${n.className}`);
    }
    const y = box.top + box.height / 2;
    const covered = [box.left + 24, box.left + box.width / 2, box.right - 24]
      .map((x) => document.elementFromPoint(x, y))
      .filter((hit) => !hit || !el.contains(hit))
      .map((hit) => hit?.tagName.toLowerCase() ?? 'nothing');
    return { inViewport: within(new DOMRect(0, 0, innerWidth, innerHeight)), clippedBy, covered };
  });
}

test.describe('the topic chips', () => {
  test.use({ reducedMotion: 'reduce' });

  test('posting one puts your bubble and Taalcut’s answer in the thread, and another replaces them', async ({
    page,
  }) => {
    await page.goto('/contact/');
    await expect(
      contactForm(page).getByRole('radiogroup', { name: 'Topics' }).getByRole('radio'),
    ).toHaveCount(5);
    for (const radio of await contactForm(page).getByRole('radio').all())
      await expect(radio).toHaveAttribute('aria-checked', 'false');

    await chip(page, 'Privacy').click();
    await expect(chip(page, 'Privacy')).toHaveAttribute('aria-checked', 'true');
    const pair = log(page).locator('[data-slot="topic-pair"]');
    await expect(pair.locator('[data-side="you"]')).toHaveText('Privacy');
    await expect(pair.locator('[data-side="taalcut"]')).toContainText('admin@matterwardlabs.com');
    await expect(pair.getByRole('link', { name: 'admin@matterwardlabs.com' })).toHaveAttribute(
      'href',
      'mailto:admin@matterwardlabs.com',
    );

    await chip(page, 'Something’s broken').click();
    await expect(pair.locator('[data-side="you"]')).toHaveText('Something’s broken');
    await expect(pair.locator('[data-side="taalcut"]')).toContainText('which computer you’re on');
    await expect(log(page).locator('[data-slot="topic-pair"]')).toHaveCount(1);
    await expect(chip(page, 'Privacy')).toHaveAttribute('aria-checked', 'false');
  });

  test('?topic= picks one when the page opens', async ({ page }) => {
    await page.goto('/contact/?topic=security');
    await expect(chip(page, 'Security')).toHaveAttribute('aria-checked', 'true');
    await expect(log(page).locator('[data-slot="topic-pair"] [data-side="taalcut"]')).toContainText(
      'admin@matterwardlabs.com',
    );
  });

  test('are one tab stop: arrows move and pick, Home and End jump, Tab leaves for the next field', async ({
    page,
  }) => {
    await page.goto('/contact/');
    await chip(page, 'Say hello').focus();
    await page.keyboard.press('ArrowRight');
    await expect(chip(page, 'Press')).toBeFocused();
    await expect(chip(page, 'Press')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('End');
    await expect(chip(page, 'Something’s broken')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(chip(page, 'Say hello')).toBeFocused();
    await expect(chip(page, 'Say hello')).toHaveAttribute('aria-checked', 'true');
    // Only the picked chip is in the tab order.
    await expect(contactForm(page).locator('[role="radio"][tabindex="0"]')).toHaveCount(1);

    await page.keyboard.press('Tab');
    const open = (await contactForm(page).getAttribute('data-forms')) !== 'closed';
    if (open) {
      // The thread's order: the topics, your name, your email, the message, Send.
      await expect(contactForm(page).getByLabel('Your name')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(contactForm(page).getByLabel('Your email')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(contactForm(page).getByLabel('Message', { exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(contactForm(page).getByRole('button', { name: 'Send message' })).toBeFocused();
    } else {
      // Closed, the fields are disabled, so the next stop is the answer's mailbox, then the closed note's.
      await expect(page.locator(':focus')).toHaveAttribute('href', /^mailto:/);
    }
  });
});

test('the thread opens with a question sticker that the topic chips answer', async ({ page }) => {
  await page.goto('/contact/');
  const question = log(page).locator('[data-slot="question"]');
  await expect(question).toContainText('Ask Taalcut anything');
  await expect(question).toContainText('Pick a topic, or just start typing.');
  await expect(question.getByRole('radiogroup', { name: 'Topics' }).getByRole('radio')).toHaveCount(5);
  // The sticker is the thread's first message (after Taalcut's typing, while the opening plays): no bubble before it.
  await expect(log(page).locator(':scope > :not([data-slot="typing"])').first()).toHaveAttribute('data-slot', 'question');
});

test('the opening types itself in, and under reduced motion it is simply there', async ({ browser }) => {
  const moving = await browser.newPage({ reducedMotion: 'no-preference' });
  await moving.goto('/contact/');
  await expect(moving.locator('[data-slot="typing"]').first()).toBeVisible();
  await expect(moving.locator('[data-slot="typing"]')).toHaveCount(0, { timeout: 5000 });
  await expect(log(moving).getByText('Ask Taalcut anything')).toBeVisible();
  await expect(chip(moving, 'Say hello')).toBeVisible();
  expect(await moving.evaluate(() => document.documentElement.hasAttribute('data-contact-typing'))).toBe(
    false,
  );
  await moving.close();

  const still = await browser.newPage({ reducedMotion: 'reduce' });
  await still.goto('/contact/');
  await expect(log(still).getByText('Ask Taalcut anything')).toBeVisible();
  await expect(still.locator('[data-slot="typing"]')).toHaveCount(0);
  expect(await still.evaluate(() => document.documentElement.hasAttribute('data-contact-typing'))).toBe(
    false,
  );
  await still.close();
});

test.describe('the one-line replies', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Return answers each one as your bubble and moves on; a bad address stays to be fixed; Change opens it again', async ({
    page,
  }) => {
    await page.goto('/contact/');
    test.skip(!(await isOpen(page)), 'The fields are closed in a build without Firebase.');
    const form = contactForm(page);
    await expect(form.getByLabel('Your name')).toHaveAttribute('placeholder', 'Your name');
    await expect(form.getByLabel('Your email')).toHaveAttribute('placeholder', 'you@example.com');

    await form.getByLabel('Your name').fill('Asha Rao');
    await form.getByLabel('Your name').press('Enter');
    await expect(answer(page, 'name').locator('[data-side="you"]')).toHaveText('Asha Rao');
    // A short answer is a one-line bubble, sized by the thread, not squeezed by its wrapper.
    expect((await answer(page, 'name').locator('[data-side="you"]').boundingBox())!.height).toBeLessThan(56);
    await expect(form.getByLabel('Your name')).toHaveCount(0);
    await expect(form.getByLabel('Your email')).toBeFocused();

    // Return on a bad address shows its problem and keeps the field; nothing is sent.
    await form.getByLabel('Your email').fill('asha@');
    await form.getByLabel('Your email').press('Enter');
    await expect(form.getByLabel('Your email')).toHaveAttribute('aria-invalid', 'true');
    await expect(form.locator('[data-slot="reply"] [data-tone="error"]')).toContainText('Add the part after the @');
    await expect(form.getByLabel('Your email')).toBeFocused();
    await expect(log(page).locator('[data-slot="posted"]')).toHaveCount(0);

    await form.getByLabel('Your email').fill('asha@example.com');
    await form.getByLabel('Your email').press('Enter');
    await expect(answer(page, 'email').locator('[data-side="you"]')).toHaveText('asha@example.com');
    await expect(form.getByLabel('Message', { exact: true })).toBeFocused();

    await answer(page, 'name').getByRole('button', { name: 'Change your name' }).click();
    await expect(form.getByLabel('Your name')).toBeFocused();
    await expect(form.getByLabel('Your name')).toHaveValue('Asha Rao');
    await expect(answer(page, 'name')).toHaveCount(0);
  });

  test('moving on answers a good one; an empty one stays a field, unscolded', async ({ page }) => {
    await page.goto('/contact/');
    test.skip(!(await isOpen(page)), 'The fields are closed in a build without Firebase.');
    const form = contactForm(page);
    await form.getByLabel('Your name').focus();
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('Your email')).toBeFocused();
    await expect(form.getByLabel('Your name')).toBeVisible();
    await expect(form.getByLabel('Your name')).not.toHaveAttribute('aria-invalid', 'true');

    await form.getByLabel('Your email').fill('asha@example.com');
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('Message', { exact: true })).toBeFocused();
    await expect(answer(page, 'email').locator('[data-side="you"]')).toHaveText('asha@example.com');
  });

  test('every bubble is a message or a control, never both', async ({ page }) => {
    await page.goto('/contact/?topic=privacy');
    const controls = log(page).locator('[data-side] :is(input, textarea, select, button)');
    await expect(controls).toHaveCount(0);
    if (!(await isOpen(page))) return;
    const form = contactForm(page);
    await form.getByLabel('Your name').fill('Asha');
    await form.getByLabel('Your name').press('Enter');
    await expect(answer(page, 'name')).toBeVisible();
    await expect(controls).toHaveCount(0);
  });
});

test.describe('the thread on short screens', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    test(`at ${size.width}×${size.height}, it grows with the page: every field shows whole, nothing sits behind the composer, and Send shows once the message has text`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.goto('/contact/');
      const form = contactForm(page);
      // No scroll of its own: the thread is as tall as what it holds.
      expect(await log(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
      for (const label of ['Your name', 'Your email']) {
        expect(await shownWhole(form.getByLabel(label)), label).toEqual({ inViewport: true, clippedBy: [], covered: [] });
      }
      // The composer is the thread's foot, in the flow, under the last message.
      const composer = form.locator('[data-slot="composer"]');
      expect(await composer.evaluate((el) => getComputedStyle(el).position)).toBe('static');
      const logBox = await log(page).boundingBox();
      const composerBox = await composer.boundingBox();
      expect(logBox!.y + logBox!.height).toBeLessThanOrEqual(composerBox!.y + 0.5);

      if (!(await isOpen(page))) return;
      await form.getByLabel('Message', { exact: true }).fill('Do you keep my clips on your servers?');
      await expect(form.getByRole('button', { name: 'Send message' })).toBeInViewport({ ratio: 1 });
    });
  }

  test('at 1440×900 the whole thread, Send included, is in the first view (closed: the note on where to write), and the other ways sit right under the words', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/contact/');
    const form = contactForm(page);
    await expect(form.getByLabel('Your email')).toBeInViewport({ ratio: 1 });
    if (await isOpen(page))
      await expect(form.getByRole('button', { name: 'Send message' })).toBeInViewport({ ratio: 1 });
    else await expect(log(page).getByText('This form is closed right now.')).toBeInViewport({ ratio: 1 });
    const lead = await page.locator('main p').first().boundingBox();
    const ways = await page.locator('#contact-ways').boundingBox();
    expect(ways!.y - (lead!.y + lead!.height)).toBeLessThanOrEqual(64);
  });
});

test('Copy puts an address on the clipboard and says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/contact/');
  const ways = page.locator('aside[aria-labelledby="contact-ways"]');
  const copy = ways.getByRole('button', { name: 'Copy admin@matterwardlabs.com' });
  await copy.click();
  await expect(ways.getByRole('button', { name: 'Copied admin@matterwardlabs.com' })).toBeVisible();
  await expect(ways.getByRole('status').first()).toHaveText('Copied: admin@matterwardlabs.com');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('admin@matterwardlabs.com');
  expect(
    (await ways.getByRole('button', { name: /admin@matterwardlabs\.com/ }).boundingBox())?.height,
  ).toBeGreaterThanOrEqual(24);
  // One address: Copy is offered once.
  await expect(ways.getByRole('button')).toHaveCount(1);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the thread’s words, the one address as a working mailto, and Instagram are there', async ({ page }) => {
    await page.goto('/contact/');
    await expect(page.locator('h1')).toHaveText('Write to us. We write back.');
    await expect(log(page).getByText('Ask Taalcut anything')).toBeVisible();
    await expect(log(page).getByText('Pick a topic, or just start typing.')).toBeVisible();
    await expect(log(page).getByText('Who’s writing?')).toBeVisible();
    await expect(log(page).getByText('And where should we reply?')).toBeVisible();
    const ways = page.locator('aside[aria-labelledby="contact-ways"]');
    await expect(ways.getByRole('link', { name: 'admin@matterwardlabs.com' })).toHaveAttribute(
      'href',
      'mailto:admin@matterwardlabs.com',
    );
    await expect(ways.locator('a[href^="mailto:"]')).toHaveCount(1);
    await expect(ways.getByRole('link', { name: 'Message us on Instagram' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/taalcut.app/',
    );
    // Copy needs a script, so it isn't offered.
    await expect(ways.getByRole('button')).toHaveCount(0);
  });

  test('says the form needs JavaScript, or, closed, where to write', async ({ request }) => {
    const html = await (await request.get('/contact/')).text();
    if (EMULATOR) expect(html).toMatch(/<noscript><p [^>]*>The form needs JavaScript\./);
    else expect(html).toContain('href="mailto:admin@matterwardlabs.com"');
    expect(html).not.toMatch(/[a-z]+@taalcut\.app/);
  });
});
