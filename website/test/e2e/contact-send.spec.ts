// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test } from '@playwright/test';
import { storedTopic } from '../../src/components/contact/topics';
import { contactForm, EMULATOR, open, storedAll, unique } from './form-helpers';

/**
 * The contact form sending, in a real browser. It is the one form the site has: the waitlist closed with the first
 * release.
 *
 * - `pnpm e2e:forms` builds with NEXT_PUBLIC_FIREBASE_EMULATOR and runs this file inside `firebase emulators:exec`,
 *   so the form writes to the Firestore emulator (demo project, App Check off) and every flow runs.
 * - `pnpm e2e` builds without config: only the closed state is checked here.
 *
 * Each run asserts the build it got (`data-forms`), so a wrong build fails rather than skipping quietly.
 */

test.describe('with the emulator', () => {
  test.skip(!EMULATOR, 'Runs under `pnpm e2e:forms` (the emulator build).');

  test('Firebase downloads only once someone starts on the form', async ({ page }) => {
    const firestore: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes(EMULATOR!)) firestore.push(r.url());
    });
    await open(page, '/contact/', 'emulator');
    await page.waitForLoadState('networkidle');
    const scripts = () =>
      page.evaluate(
        () => performance.getEntriesByType('resource').filter((e) => /\.js($|\?)/.test(e.name)).length,
      );
    const before = await scripts();
    expect(firestore).toEqual([]);
    await contactForm(page).getByLabel('Your name').focus();
    await page.waitForLoadState('networkidle');
    await expect.poll(scripts).toBeGreaterThan(before);
    expect(firestore).toEqual([]);
  });

  test('the contact form sends a message for a reply by email', async ({ page, request }) => {
    const email = unique('contact');
    await open(page, '/contact/?topic=privacy', 'emulator');
    const form = contactForm(page);
    await expect(form.getByRole('radio', { name: 'Privacy' })).toHaveAttribute('aria-checked', 'true');
    await form.getByRole('button', { name: 'Send message' }).click();
    await expect(form.getByLabel('Your name')).toBeFocused();
    await expect(form.getByLabel('Your name')).toHaveAccessibleDescription(/Add your name/);
    await form.getByLabel('Your name').fill('Asha');
    await form.getByLabel('Your email').fill(email);
    await form.getByLabel('Message', { exact: true }).fill('Please delete what you hold about me.');
    await form.getByRole('button', { name: 'Send message' }).click();
    await expect(form.getByRole('status')).toContainText('Thanks, your message is in.');
    // In the thread: your message as your bubble, its receipt, and focus on Taalcut's thanks.
    await expect(form.getByRole('log').locator('[data-slot="posted"] [data-side="you"]')).toHaveText(
      'Please delete what you hold about me.',
    );
    await expect(form.getByRole('log').getByText('Sent', { exact: true })).toBeVisible();
    await expect(page.locator(':focus')).toContainText('Thanks, your message is in.');

    const mine = (await storedAll(request, 'contact')).find((d) => d.fields.email?.stringValue === email);
    expect(mine?.fields.topic?.stringValue).toBe('privacy');
    expect(mine?.fields.message?.stringValue).toBe('Please delete what you hold about me.');
  });

  test('the contact thread sends under the picked topic: your bubble, Sent, the thanks, and Kaatu cheers', async ({
    page,
    request,
  }) => {
    const email = unique('thread');
    await open(page, '/contact/', 'emulator');
    const thread = contactForm(page);
    await thread.getByRole('radio', { name: 'Security' }).click();
    await thread.getByLabel('Your name').fill('Asha');
    await thread.getByLabel('Your email').fill(email);
    await thread.getByLabel('Message', { exact: true }).fill('The contact form accepts a script tag.');
    await thread.getByRole('button', { name: 'Send message' }).click();

    const posted = thread.getByRole('log').locator('[data-slot="posted"]');
    await expect(posted.locator('[data-side="you"]')).toHaveText('The contact form accepts a script tag.');
    await expect(posted.getByText('Sent', { exact: true })).toBeVisible();
    // Your name and address became your answers as you moved on from each.
    await expect(thread.locator('[data-slot="answer"][data-field="name"] [data-side="you"]')).toHaveText(
      'Asha',
    );
    await expect(thread.locator('[data-slot="answer"][data-field="email"] [data-side="you"]')).toHaveText(
      email,
    );
    await expect(thread.getByRole('status')).toContainText(
      `Thanks, your message is in. A reply comes by email, to ${email}.`,
    );
    await expect(thread.locator('[data-slot="kaatu"]').first()).toHaveAttribute('data-pose', 'cheer');
    await expect(thread.getByRole('button', { name: 'Write another' })).toBeVisible();

    const mine = (await storedAll(request, 'contact')).find((d) => d.fields.email?.stringValue === email);
    expect(mine?.fields.topic?.stringValue).toBe(storedTopic('security'));
    expect(mine?.fields.name?.stringValue).toBe('Asha');
  });

  test('a failed send shows in the thread under your bubble, never as a banner, and Try again sends it', async ({
    page,
    context,
    request,
  }) => {
    const email = unique('thread-offline');
    await open(page, '/contact/', 'emulator');
    const thread = contactForm(page);
    await thread.getByLabel('Your name').fill('Asha');
    await thread.getByLabel('Your email').fill(email);
    await thread.getByLabel('Message', { exact: true }).fill('Hello from a train.');
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await thread.getByRole('button', { name: 'Send message' }).click();

    const posted = thread.getByRole('log').locator('[data-slot="posted"]');
    await expect(posted.locator('[data-side="you"]')).toHaveText('Hello from a train.');
    const line = posted.locator('[data-tone="offline"]');
    await expect(line).toContainText('You’re offline. Nothing was sent.');
    await expect(line).toHaveAttribute('role', 'alert');
    // The composer emptied when the bubble posted; the failure lives under the bubble, inside the thread.
    await expect(thread.getByLabel('Message', { exact: true })).toHaveValue('');
    await expect(thread.locator(':scope > [role="alert"], :scope > form > [role="alert"]')).toHaveCount(0);
    await expect(thread.locator('[data-slot="kaatu"]').first()).toHaveAttribute('data-mood', 'oops');

    await context.setOffline(false);
    await line.getByRole('button', { name: 'Try again' }).click();
    await expect(thread.getByRole('status')).toContainText('Thanks, your message is in.');
    const mine = (await storedAll(request, 'contact')).find((d) => d.fields.email?.stringValue === email);
    expect(mine?.fields.message?.stringValue).toBe('Hello from a train.');
  });
});

test.describe('without Firebase config', () => {
  test.skip(!!EMULATOR, 'The emulator build has config.');

  test('the contact form is closed and points at the mailbox', async ({ page }) => {
    await open(page, '/contact/', 'closed');
    const form = page.locator('section[aria-labelledby="contact-form"]');
    await expect(form.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await expect(form.getByRole('link', { name: 'admin@matterwardlabs.com' })).toHaveAttribute(
      'href',
      'mailto:admin@matterwardlabs.com',
    );
  });
});
