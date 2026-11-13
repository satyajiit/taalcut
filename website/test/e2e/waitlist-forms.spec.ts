// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Locator, type Page } from '@playwright/test';
import { storedTopic } from '../../src/components/contact/topics';
import { band, contactForm, EMULATOR, heroForm, open, pageForm, STATUS_LINE, stored, storedAll, top, unique } from './waitlist-helpers';

/**
 * Two forms on one page, and the failure lines in their slots. Runs under `pnpm e2e:waitlist` (the emulator build),
 * beside waitlist.spec.ts.
 *
 * - The home page has two waitlist forms, the hero's and the closing band's. Each keeps its own problem and failure;
 *   they share the typed address and the joined state, and the Kaatu beside a form follows that form.
 * - The offline and network-failure lines end with an inline Try again and fit the slot under the field, so nothing
 *   under the form moves, from 320 px to 1440.
 */

test.skip(!EMULATOR, 'Runs under `pnpm e2e:waitlist` (the emulator build).');

const join = (form: Locator) => form.getByRole('button', { name: 'Join the waitlist' });
const consent = (form: Locator) => form.getByText('One email when the beta opens.');
const kaatu = (form: Locator) => form.locator('[data-slot="kaatu"]');

test('each form shows its own problem, and a sign-up in one shows in both', async ({ page, context, request }) => {
  const hero = heroForm(page);
  const close = band(page, 'home-close');

  // A problem in the hero stays in the hero, and the band's Kaatu keeps waving.
  await open(page, '/', 'emulator');
  await hero.getByLabel('Your email').fill('asha');
  await join(hero).click();
  await expect(hero.locator('[data-tone="error"]')).toContainText('Add the @');
  await expect(close.locator(STATUS_LINE)).toHaveCount(0);
  await expect(close.getByLabel('Your email')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(kaatu(close)).toHaveAttribute('data-mood', 'wave');

  // The reverse, on a fresh page: the band's problem stays in the band, and its Kaatu says oops.
  await open(page, '/', 'emulator');
  await close.getByLabel('Your email').fill('asha@');
  await join(close).click();
  await expect(close.locator('[data-tone="error"]')).toContainText('Add the part after the @');
  await expect(kaatu(close)).toHaveAttribute('data-mood', 'oops');
  await expect(hero.locator(STATUS_LINE)).toHaveCount(0);
  await expect(hero.getByLabel('Your email')).not.toHaveAttribute('aria-invalid', 'true');

  // Offline in the hero: the hero says so, the band doesn't, and the band's consent line stays put.
  const email = unique('two-forms');
  await open(page, '/', 'emulator');
  await hero.getByLabel('Your email').fill(email);
  await page.waitForLoadState('networkidle');
  const bandIdle = await top(consent(close));
  await context.setOffline(true);
  await join(hero).click();
  await expect(hero.locator('[data-tone="offline"]')).toBeVisible();
  await expect(close.locator(STATUS_LINE)).toHaveCount(0);
  await expect(kaatu(close)).toHaveAttribute('data-mood', 'wave');
  expect(await top(consent(close)), 'the band’s consent line').toBe(bandIdle);

  // Back online, Try again joins from the hero, and both forms say so; the band's Kaatu is delighted.
  await context.setOffline(false);
  await hero.getByRole('button', { name: 'Try again' }).click();
  await expect(hero.getByRole('status')).toContainText('You’re on the list.');
  await expect(close.getByRole('status')).toContainText('You’re on the list.');
  await expect(kaatu(close)).toHaveAttribute('data-mood', 'delighted');
  // Focus goes to the line that replaced the form that was sent, not the band's.
  await expect(page.locator(':focus')).toContainText('You’re on the list.');
  expect(await hero.locator(':focus').count()).toBe(1);
  expect((await stored(request, `waitlist/${email}`))?.source?.stringValue).toBe('home-hero');
});

/**
 * Each route's form, what fills it, and what sits under it that mustn't move. The contact thread `grows`: a send
 * posts your message as a bubble, and the thread grows with the page, so there what mustn't move is measured from the
 * posted message, and the check is that one failure line taking another's place moves nothing.
 */
const ROUTES: readonly {
  readonly path: string;
  readonly form: (page: Page) => Locator;
  readonly fill: (form: Locator) => Promise<void>;
  readonly below: (page: Page) => Locator[];
  readonly grows?: boolean;
}[] = [
  {
    path: '/',
    form: heroForm,
    fill: (form) => form.getByLabel('Your email').fill('layout-check@example.invalid'),
    below: (page) => [consent(heroForm(page)), consent(band(page, 'home-close'))],
  },
  {
    path: '/waitlist/',
    form: pageForm,
    fill: (form) => form.getByLabel('Your email').fill('layout-check@example.invalid'),
    below: (page) => [consent(pageForm(page))],
  },
  {
    path: '/contact/',
    form: contactForm,
    fill: async (form) => {
      await form.getByLabel('Your name').fill('Layout check');
      await form.getByLabel('Your email').fill('layout-check@example.invalid');
      await form.getByLabel('Message', { exact: true }).fill('Nothing is sent: the browser is offline or blocked.');
    },
    below: (page) => [page.locator('aside[aria-labelledby="contact-ways"]'), consent(band(page, 'contact'))],
    grows: true,
  },
];

test('the offline and network-failure lines fit their slot, so nothing under the form moves', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const emulator = (url: URL) => url.host === EMULATOR;
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ROUTES) {
      await open(page, route.path, 'emulator');
      const form = route.form(page);
      await route.fill(form);
      await page.waitForLoadState('networkidle');
      const tops = () => Promise.all(route.below(page).map(top));
      const before = route.grows ? null : await tops();
      const where = `${route.path} at ${width} px`;

      // Offline: the browser says so, and nothing is written.
      await context.setOffline(true);
      await form.getByRole('button', { name: /Join the waitlist|Send message/ }).click();
      const offline = form.locator('[data-tone="offline"]');
      await expect(offline, where).toContainText('You’re offline. Nothing was sent.');
      const idle = before ?? (await tops());
      expect(await tops(), `offline, ${where}`).toEqual(idle);
      const retry = offline.getByRole('button', { name: 'Try again' });
      expect((await retry.boundingBox())?.height, `Try again's target, ${where}`).toBeGreaterThanOrEqual(24);

      // Online, but the request never reaches Firestore (a blocker, a captive portal).
      await context.setOffline(false);
      await page.route(emulator, (r) => r.abort('failed'));
      await retry.click();
      const failed = form.locator('[data-tone="error"]');
      await expect(failed, where).toContainText('We couldn’t reach');
      await expect(failed.getByRole('button', { name: 'Try again' })).toBeVisible();
      expect(await tops(), `network failure, ${where}`).toEqual(idle);
      await page.unroute(emulator);
    }
  }
});

test('the contact thread sends under the picked topic: your bubble, Sent, the thanks, and Kaatu cheers', async ({ page, request }) => {
  const email = unique('thread');
  await open(page, '/contact/', 'emulator');
  const thread = contactForm(page);
  await thread.getByRole('radio', { name: 'Security' }).click();
  await thread.getByLabel('Your name').fill('Asha');
  await thread.getByLabel('Your email').fill(email);
  await thread.getByLabel('Message', { exact: true }).fill('The waitlist form accepts a script tag.');
  await thread.getByRole('button', { name: 'Send message' }).click();

  const posted = thread.getByRole('log').locator('[data-slot="posted"]');
  await expect(posted.locator('[data-side="you"]')).toHaveText('The waitlist form accepts a script tag.');
  await expect(posted.getByText('Sent', { exact: true })).toBeVisible();
  // Your name and address became your answers as you moved on from each.
  await expect(thread.locator('[data-slot="answer"][data-field="name"] [data-side="you"]')).toHaveText('Asha');
  await expect(thread.locator('[data-slot="answer"][data-field="email"] [data-side="you"]')).toHaveText(email);
  await expect(thread.getByRole('status')).toContainText(`Thanks, your message is in. A reply comes by email, to ${email}.`);
  await expect(thread.locator('[data-slot="kaatu"]').first()).toHaveAttribute('data-pose', 'cheer');
  await expect(thread.getByRole('button', { name: 'Write another' })).toBeVisible();

  const mine = (await storedAll(request, 'contact')).find((d) => d.fields.email?.stringValue === email);
  expect(mine?.fields.topic?.stringValue).toBe(storedTopic('security'));
  expect(mine?.fields.name?.stringValue).toBe('Asha');
});

test('a failed send shows in the thread under your bubble, never as a banner, and Try again sends it', async ({ page, context, request }) => {
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
