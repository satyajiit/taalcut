// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test } from '@playwright/test';
import { contactForm, EMULATOR, open, pageForm, STATUS_LINE, stored, storedAll, strings, success, top, unique } from './waitlist-helpers';

/**
 * The waitlist and contact forms in a real browser.
 *
 * - `pnpm e2e:waitlist` builds with NEXT_PUBLIC_FIREBASE_EMULATOR and runs this file (and waitlist-forms.spec.ts)
 *   inside `firebase emulators:exec`, so the forms write to the Firestore emulator (demo project, App Check off) and
 *   every flow runs.
 * - `pnpm e2e` builds without config: only the closed state is checked here.
 *
 * Each run asserts the build it got (`data-waitlist`), so a wrong build fails rather than skipping quietly.
 */

test('/waitlist/ and /contact/ never scroll sideways on a phone', async ({ page }) => {
  for (const width of [320, 375, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['/waitlist/', '/contact/']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { scroll, inner } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(scroll, `${path} at ${width} px`).toBe(inner);
    }
  }
});

test.describe('with the emulator', () => {
  test.skip(!EMULATOR, 'Runs under `pnpm e2e:waitlist` (the emulator build).');

  test('joins from the Instagram link and stores exactly what the form shows', async ({ page, request }) => {
    const email = unique('join');
    await open(page, '/waitlist/?ref=ig', 'emulator');
    const form = pageForm(page);
    // Nothing is ticked for you: the link names no platform.
    await expect(form.getByRole('checkbox')).toHaveCount(3);
    for (const box of await form.getByRole('checkbox').all()) await expect(box).not.toBeChecked();
    await form.getByLabel('Your email').fill(`  ${email.toUpperCase()} `);
    await form.getByRole('checkbox', { name: 'Ubuntu' }).check();
    await form.getByRole('checkbox', { name: 'macOS' }).check();
    await form.getByLabel('What do you make?').selectOption('day-in-life');
    await form.getByRole('button', { name: 'Join the waitlist' }).click();

    await expect(success(page)).toBeVisible();
    // Focus moves to the line that replaced the form, so a keyboard user carries on from there.
    await expect(page.locator(':focus')).toContainText('You’re on the list.');
    await expect(page.getByRole('link', { name: '@taalcut.app' }).first()).toHaveAttribute('href', /instagram\.com\/taalcut\.app/);

    const doc = await stored(request, `waitlist/${email}`);
    expect(doc?.email?.stringValue).toBe(email);
    expect(strings(doc?.platforms)).toEqual(['macos', 'ubuntu']);
    expect(doc?.make?.stringValue).toBe('day-in-life');
    expect(doc?.source?.stringValue).toBe('ig');
    expect(doc?.consentVersion?.stringValue).toBe('waitlist-2026-11');
    expect(doc?.createdAt?.timestampValue).toBeTruthy();
  });

  test('a ?platform= link ticks that platform and no other', async ({ page, request }) => {
    const email = unique('platform');
    await open(page, '/waitlist/?platform=ubuntu', 'emulator');
    const form = pageForm(page);
    await expect(form.getByRole('checkbox', { name: 'Ubuntu' })).toBeChecked();
    await expect(form.getByRole('checkbox', { name: 'macOS' })).not.toBeChecked();
    await expect(form.getByRole('checkbox', { name: 'Windows' })).not.toBeChecked();
    await form.getByLabel('Your email').fill(email);
    await form.getByRole('button', { name: 'Join the waitlist' }).click();
    await expect(success(page)).toBeVisible();
    expect(strings((await stored(request, `waitlist/${email}`))?.platforms)).toEqual(['ubuntu']);
  });

  test('a repeat sign-up looks exactly like the first and changes nothing', async ({ page, request }) => {
    const email = unique('again');
    for (const _ of [1, 2]) {
      await open(page, '/waitlist/', 'emulator');
      await pageForm(page).getByLabel('Your email').fill(email);
      await pageForm(page).getByRole('button', { name: 'Join the waitlist' }).click();
      await expect(success(page)).toBeVisible();
      await expect(pageForm(page).locator(STATUS_LINE)).toHaveCount(0);
    }
    const doc = await stored(request, `waitlist/${email}`);
    expect(doc?.source?.stringValue).toBe('waitlist-page');
    // Joined with nothing ticked: a valid sign-up, stored with no platform.
    expect(strings(doc?.platforms)).toEqual([]);
  });

  test('a bad address says what to fix and puts focus back in the field', async ({ page, request }) => {
    await open(page, '/waitlist/', 'emulator');
    const field = pageForm(page).getByLabel('Your email');
    await field.fill('asha@');
    await pageForm(page).getByRole('button', { name: 'Join the waitlist' }).click();
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveAccessibleDescription(/Add the part after the @, like example\.com\./);
    // Typing clears it: the field never scolds while someone is still writing.
    await field.pressSequentially('example.com');
    await expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(await stored(request, 'waitlist/asha@')).toBeNull();
  });

  test('a problem fills its line under the field, and nothing under it moves', async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, '/waitlist/', 'emulator');
      const form = pageForm(page);
      const consent = form.getByText('One email when the beta opens.');
      const idle = await top(consent);
      for (const raw of ['', 'asha', 'asha@', '@example.com']) {
        await form.getByLabel('Your email').fill(raw);
        await form.getByRole('button', { name: 'Join the waitlist' }).click();
        await expect(form.locator('[data-tone="error"]')).toBeVisible();
        expect(await top(consent), `the consent line, "${raw}" at ${width} px`).toBe(idle);
      }

      await open(page, '/contact/', 'emulator');
      const band = page.locator('section[aria-labelledby="band-contact"]');
      const bandConsent = band.getByText('One email when the beta opens.');
      const bandIdle = await top(bandConsent);
      await band.getByRole('button', { name: 'Join the waitlist' }).click();
      await expect(band.locator('[data-tone="error"]')).toBeVisible();
      expect(await top(bandConsent), `the band's consent line at ${width} px`).toBe(bandIdle);

      const contact = contactForm(page);
      const send = contact.getByRole('button', { name: 'Send message' });
      const sendIdle = await top(send);
      await send.click();
      await expect(contact.locator('[data-tone="error"]')).toHaveCount(3);
      expect(await top(send), `the contact form's button at ${width} px`).toBe(sendIdle);
    }
  });

  test('the button keeps one face from the server HTML on', async ({ page }) => {
    // Every face the button shows while the page loads and hydrates: its classes and whether it is disabled.
    await page.addInitScript(() => {
      const faces = new Set<string>();
      Object.assign(window, { __faces: faces });
      const look = () => {
        const button = document.querySelector<HTMLButtonElement>('main [data-variant="page"] button[type="submit"]');
        if (button) faces.add(`${button.disabled} ${button.className}`);
      };
      new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true });
    });
    await open(page, '/waitlist/', 'emulator');
    await page.waitForLoadState('networkidle');
    await expect(pageForm(page).getByRole('button', { name: 'Join the waitlist' })).toBeEnabled();
    const faces = await page.evaluate(() => [...(window as unknown as { __faces: Set<string> }).__faces]);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatch(/^false .*\bbg-marigold\b/);
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('a send carries nothing to the address bar, and a line says the form needs JavaScript', async ({
      page,
      request,
    }) => {
      // Chromium with scripts switched off through DevTools still parses <noscript> as text, so the line is read
      // from the served HTML.
      const noscript = (html: string, words: string) =>
        expect(html).toMatch(new RegExp(`<noscript><p [^>]*>${words.replace(/\./g, '\\.')}`));
      noscript(await (await request.get('/waitlist/')).text(), 'Joining needs JavaScript.');
      noscript(await (await request.get('/contact/')).text(), 'The form needs JavaScript.');

      const email = 'asha.nojs@example.com';
      await open(page, '/waitlist/?ref=ig', 'emulator');
      const form = pageForm(page);
      const button = form.getByRole('button', { name: 'Join the waitlist' });
      await expect(button).toBeEnabled();
      await form.getByLabel('Your email').fill(email);
      await form.getByRole('checkbox', { name: 'Ubuntu' }).check();
      // A native send: the page reloads itself, with nothing in the address and no body.
      const [sent] = await Promise.all([page.waitForRequest((r) => r.isNavigationRequest()), button.click()]);
      await page.waitForLoadState('load');
      expect(sent.method()).toBe('GET');
      expect(sent.postData()).toBeNull();
      expect(new URL(page.url()).pathname).toBe('/waitlist/');
      expect(page.url()).not.toMatch(/asha|%40|@|example|ubuntu|platform/);

      await open(page, '/contact/', 'emulator');
      const contact = contactForm(page);
      await contact.getByLabel('Your name').fill('Asha');
      await contact.getByLabel('Your email').fill(email);
      await contact.getByLabel('Message', { exact: true }).fill('Hello');
      const [again] = await Promise.all([
        page.waitForRequest((r) => r.isNavigationRequest()),
        contact.getByRole('button', { name: 'Send message' }).click(),
      ]);
      await page.waitForLoadState('load');
      expect(again.method()).toBe('GET');
      expect(again.postData()).toBeNull();
      expect(new URL(page.url()).pathname).toBe('/contact/');
      expect(page.url()).not.toMatch(/asha|%40|@|example|hello|topic/i);
    });
  });

  test('offline, it says so and keeps the email; Try again sends it', async ({ page, context, request }) => {
    const email = unique('offline');
    await open(page, '/waitlist/', 'emulator');
    const field = pageForm(page).getByLabel('Your email');
    await field.fill(email);
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await pageForm(page).getByRole('button', { name: 'Join the waitlist' }).click();
    const line = page.getByRole('alert').filter({ hasText: 'offline' });
    await expect(line).toContainText('You’re offline.');
    await expect(field).toHaveValue(email);
    await context.setOffline(false);
    await line.getByRole('button', { name: 'Try again' }).click();
    await expect(success(page)).toBeVisible();
    expect((await stored(request, `waitlist/${email}`))?.email?.stringValue).toBe(email);
  });

  test('an inline form stores its section and no platform', async ({ page, request }) => {
    const email = unique('band');
    await open(page, '/contact/', 'emulator');
    const band = page.locator('section[aria-labelledby="band-contact"]');
    await band.getByLabel('Your email').fill(email);
    await band.getByRole('button', { name: 'Join the waitlist' }).click();
    await expect(band.getByRole('status')).toContainText('You’re on the list.');
    const doc = await stored(request, `waitlist/${email}`);
    expect(doc?.source?.stringValue).toBe('contact');
    expect(strings(doc?.platforms)).toEqual([]);
    expect(doc?.make?.nullValue).toBeNull();
  });

  test('Firebase downloads only once someone starts on the form', async ({ page }) => {
    const firestore: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes(EMULATOR!)) firestore.push(r.url());
    });
    await open(page, '/waitlist/', 'emulator');
    await page.waitForLoadState('networkidle');
    const scripts = () => page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\.js($|\?)/.test(e.name)).length);
    const before = await scripts();
    expect(firestore).toEqual([]);
    await pageForm(page).getByLabel('Your email').focus();
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
    await form.getByLabel('Message', { exact: true }).fill('Please delete my waitlist entry.');
    await form.getByRole('button', { name: 'Send message' }).click();
    await expect(form.getByRole('status')).toContainText('Thanks, your message is in.');
    // In the thread: your message as your bubble, its receipt, and focus on Taalcut's thanks.
    await expect(form.getByRole('log').locator('[data-slot="posted"] [data-side="you"]')).toHaveText('Please delete my waitlist entry.');
    await expect(form.getByRole('log').getByText('Sent', { exact: true })).toBeVisible();
    await expect(page.locator(':focus')).toContainText('Thanks, your message is in.');

    const mine = (await storedAll(request, 'contact')).find((d) => d.fields.email?.stringValue === email);
    expect(mine?.fields.topic?.stringValue).toBe('privacy');
    expect(mine?.fields.message?.stringValue).toBe('Please delete my waitlist entry.');
  });
});

test.describe('without Firebase config', () => {
  test.skip(!!EMULATOR, 'The emulator build has config.');

  test('the waitlist page is closed and says where news goes', async ({ page }) => {
    await open(page, '/waitlist/', 'closed');
    const form = pageForm(page);
    await expect(form.getByLabel('Your email')).toBeDisabled();
    await expect(form.getByRole('button', { name: 'Join the waitlist' })).toBeDisabled();
    await expect(form).toContainText('The waitlist opens soon. Follow @taalcut.app on Instagram for news.');
    await expect(form.getByRole('link', { name: '@taalcut.app' })).toHaveAttribute('href', 'https://www.instagram.com/taalcut.app/');
  });

  test('the contact form is closed and points at the mailbox', async ({ page }) => {
    await open(page, '/contact/', 'closed');
    const form = page.locator('section[aria-labelledby="contact-form"]');
    await expect(form.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await expect(form.getByRole('link', { name: 'admin@matterwardlabs.com' })).toHaveAttribute('href', 'mailto:admin@matterwardlabs.com');
  });
});
