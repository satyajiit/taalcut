// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX round 1 (W2-5), the transcript as a person meets it: one marigold primary and one waiting line, the agent's
// sentence before the card it explains, the consent card naming the step, a failed answer that keeps its card open
// with Try again, a message that shows the moment it's sent (and says "Not sent" when it didn't go), and a composer
// that keeps your words while the chat can't take them.
import { expect, test, type Page } from '@playwright/test';
import { fakeChat, open, preferences, watchProblems } from './support.ts';

const SEEDED_ID = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6';
const SEEDED = `/chat/${SEEDED_ID}`;

type FakeFailure = 'load' | 'send' | 'answer';

declare global {
  interface Window {
    /** The fake chat (src/services/create.ts, preview services only): the part this spec uses. */
    taalcutFakeChat?: { failNext(what: FakeFailure): void };
  }
}

/** The fake chat fails the next load, send or answer as if the agent had restarted (src/chat/fake-client.ts). */
async function failNext(page: Page, what: FakeFailure) {
  await page.evaluate((kind) => {
    const chat = window.taalcutFakeChat;
    if (!chat) throw new Error('no fake chat');
    chat.failNext(kind);
  }, what);
}

const transcript = (page: Page) => page.locator('[data-slot=transcript]');
const box = (page: Page) => page.getByRole('textbox', { name: 'Message Taalcut' });
/** Marigold fills on the page: the kit's primary Button. */
const marigold = (page: Page) => page.locator('button.bg-primary:visible');

test.describe('the transcript (UX round 1)', () => {
  test.beforeEach(async ({ page }) => {
    await preferences(page, { locale: 'en', theme: 'light' });
  });

  test('one marigold primary, one waiting line, and each sentence before the card it explains', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await fakeChat(page, { latencyMs: 50 });
    await open(page, { name: 'chat-conversation', path: SEEDED });
    await expect(marigold(page)).toHaveCount(1);
    await expect(page.locator('[data-card-type=consent]').locator('button.bg-primary')).toHaveCount(1);
    await expect(page.locator('[data-notice=paused]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(1);

    // The words, then the card; the cost in the words is the card's.
    const order = await transcript(page)
      .locator(':scope > li')
      .evaluateAll((rows) =>
        rows.map(
          (row) => row.querySelector('[data-card-type]')?.getAttribute('data-card-type') ?? row.textContent,
        ),
      );
    const costWords = order.findIndex((row) => row?.includes('about $0.042'));
    expect(costWords).toBeGreaterThan(-1);
    expect(order[costWords + 1]).toBe('costEstimate');
    const consentWords = order.findIndex((row) => row?.includes('To describe this clip'));
    expect(order[consentWords + 1]).toBe('consent');

    // The consent card says the step in words, the file by name, and who it goes to.
    await expect(page.locator('[data-card-type=consent]')).toContainText(
      'Describing IMG_0418.MOV sends one frame of it to Google.',
    );
    expect(problems).toEqual([]);
  });

  test('a failed answer keeps the card open with the cause and Try again', async ({ page }) => {
    await fakeChat(page, { latencyMs: 50 });
    await open(page, { name: 'chat-conversation', path: SEEDED });
    const consent = page.locator('[data-card-type=consent]');
    await failNext(page, 'answer');
    await consent.getByRole('button', { name: 'Allow once' }).click();
    // Not settled: still asking, with the cause on the card and no toast.
    await expect(consent.getByRole('alert')).toContainText('Part of Taalcut restarted');
    await expect(consent).toHaveAttribute('data-status', 'pending');
    await expect(consent.getByRole('button', { name: 'Allow once' })).toBeVisible();
    await expect(page.locator('[data-slot=toast]')).toHaveCount(0);
    await consent.getByRole('button', { name: 'Try again' }).click();
    await expect(consent).toHaveAttribute('data-status', 'approved');
    await expect(consent.getByRole('alert')).toHaveCount(0);
  });

  test('a message shows the moment it is sent, and one that didn’t go says so where you wrote it', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await fakeChat(page, { latencyMs: 600 });
    await open(page, { name: 'chat-conversation', path: SEEDED });
    // The open question is answered "Not now" first (a round trip): the message is on screen meanwhile.
    await box(page).fill('Thanks, that helps');
    await box(page).press('Enter');
    const sending = transcript(page).locator('[data-outgoing=sending]');
    await expect(sending).toContainText('Thanks, that helps');
    await expect(sending).toHaveCount(0, { timeout: 10_000 });
    await expect(
      transcript(page).locator('[data-item=user]').filter({ hasText: 'Thanks, that helps' }),
    ).toHaveCount(1);

    await failNext(page, 'send');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 15_000 });
    await box(page).fill('What about music?');
    await box(page).press('Enter');
    const failed = transcript(page).locator('[data-outgoing=failed]');
    await expect(failed).toContainText('What about music?');
    await expect(failed).toContainText('Not sent');
    const error = page.locator('[data-slot=error-card]');
    await expect(error).toContainText('Part of Taalcut restarted');
    // Try again sends it as it was; it stays where it is, now stored.
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(failed).toHaveCount(0);
    await expect(error).toHaveCount(0);
    await expect(
      transcript(page).locator('[data-item=user]').filter({ hasText: 'What about music?' }),
    ).toHaveCount(1);

    // Dismissed instead, the words come back to the composer.
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 15_000 });
    await failNext(page, 'send');
    await box(page).fill('One more question');
    await box(page).press('Enter');
    await expect(failed).toContainText('One more question');
    await error.getByRole('button', { name: 'Dismiss' }).click();
    await expect(failed).toHaveCount(0);
    await expect(box(page)).toHaveValue('One more question');
    await expect(box(page)).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('the composer keeps your words while the chat is opening, and sends once it can', async ({ page }) => {
    await fakeChat(page, { latencyMs: 2_500 });
    await page.goto(SEEDED);
    await expect(page.locator('[data-boneyard][aria-busy="true"]').first()).toBeVisible();
    await box(page).fill('Which clip is the brightest?');
    await box(page).press('Enter');
    await expect(box(page)).toHaveValue('Which clip is the brightest?');
    await expect(page.locator('[data-slot=composer-hold]')).toHaveText(
      'This chat is still opening. Your message can go in a moment.',
    );
    await expect(page.locator('[data-slot=chat-message][data-role=user]').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-slot=composer-hold]')).toHaveCount(0);
    await box(page).press('Enter');
    await expect(
      transcript(page).locator('[data-item=user]').filter({ hasText: 'Which clip is the brightest?' }),
    ).toHaveCount(1, { timeout: 15_000 });
  });

  test('a chat that didn’t open holds the composer and opens on Try again', async ({ page }) => {
    await fakeChat(page, { latencyMs: 50 });
    await open(page, { name: 'chat-conversation', path: SEEDED });
    await failNext(page, 'load');
    await page.getByRole('link', { name: /Diwali highlights/ }).click();
    const error = page.locator('[data-slot=error-card]');
    await expect(error).toContainText('Part of Taalcut restarted');
    await box(page).fill('Find the fireworks');
    await box(page).press('Enter');
    await expect(box(page)).toHaveValue('Find the fireworks');
    await expect(page.locator('[data-slot=composer-hold]')).toContainText('This chat didn’t open');
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(error).toHaveCount(0);
    await expect(page.locator('[data-slot=composer-hold]')).toHaveCount(0);
    await expect(box(page)).toHaveValue('Find the fireworks');
  });
});
