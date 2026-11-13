// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P1-H3 "Done when": the scripted gate-demo conversation ("Add my
// Desktop/Trip folder and tell me what's in the first video": add source,
// probe, describe frame) streams, and Stop cancels the run.
import { expect, test, type Page } from '@playwright/test';
import { fakeChat, open, preferences, screenshotWhole, watchProblems } from './support.ts';

const PROMPT = "Add my Desktop/Trip folder and tell me what's in the first video";
// A fresh, valid ULID: a conversation the fake has never seen.
const NEW_CHAT = '/chat/01K7C5M6Q8R9S0T1V2W3X4YZZZ';
const SEEDED_ID = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6';
const SEEDED = `/chat/${SEEDED_ID}`;

async function ask(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'Message Taalcut' });
  await box.fill(text);
  await box.press('Enter');
}

/** Lengths of the answer's text, sampled while it streams. */
async function sampleAnswer(page: Page, samples: number, everyMs: number): Promise<number[]> {
  const answer = page.locator('[data-slot=chat-message][data-role=agent]').last();
  const lengths: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    lengths.push(((await answer.textContent()) ?? '').length);
    await page.waitForTimeout(everyMs);
  }
  return lengths;
}

test.describe('chat', () => {
  test.beforeEach(async ({ page }) => {
    await preferences(page, { locale: 'en', theme: 'light' });
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the gate demo streams to the end (${theme})`, async ({ page }) => {
      const problems = await watchProblems(page);
      await preferences(page, { theme });
      await fakeChat(page, { latencyMs: 50, speed: 3 });
      await open(page, { name: 'chat-new', path: NEW_CHAT });
      // An empty chat is the start surface: a heading, the four ways in (P2-M13) and the composer.
      await expect(page.getByRole('heading', { name: 'Tell Taalcut what to make' })).toBeVisible();
      await expect(page.getByRole('list', { name: 'Ways to start' }).getByRole('button')).toHaveCount(4);

      await ask(page, PROMPT);
      await expect(page.locator('[data-slot=chat-message][data-role=user]')).toContainText(PROMPT);
      // While it runs, the send button is Stop.
      await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
      const activity = page.locator('[data-slot=run-activity-toggle]');
      await expect(activity).toHaveAttribute('aria-expanded', 'false');
      await activity.click();
      await expect(page.locator('[data-activity-note=reasoning]')).toBeVisible();

      const plan = page.locator('[data-card-type=plan]');
      await expect(plan.locator('li')).toHaveCount(3);

      // The three tools, in order, each finishing.
      const tools = page.locator('[data-card-type=toolRun]');
      await expect(tools).toHaveCount(3, { timeout: 10_000 });
      await expect(tools.nth(0)).toContainText('Add a folder');
      await expect(tools.nth(1)).toContainText('Check the video');
      await expect(tools.nth(2)).toContainText('Look at a frame');

      // The answer streams in: its text grows while it is busy.
      const answer = page.locator('[data-slot=chat-message][data-role=agent]').last();
      await expect(answer).toHaveAttribute('data-streaming', 'true', { timeout: 10_000 });
      const lengths = await sampleAnswer(page, 5, 60);
      expect(new Set(lengths).size, `answer lengths ${lengths.join(', ')}`).toBeGreaterThan(2);

      await expect(answer).not.toHaveAttribute('data-streaming', 'true', { timeout: 10_000 });
      await expect(answer).toContainText('a beach at sunset');
      await expect(page.locator('[data-card-type=toolRun][data-status=succeeded]')).toHaveCount(3);
      await expect(plan.locator('li[data-step-status=done]')).toHaveCount(3);
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();

      // The new conversation is in the list, titled by its first message.
      await expect(page.getByRole('navigation', { name: 'Chats' })).toContainText(
        'Add my Desktop/Trip folder',
      );
      await screenshotWhole(page, `screenshots/${theme}/chat-gate-demo.png`);
      expect(problems).toEqual([]);
    });
  }

  test('Stop cancels the run mid-answer and nothing more arrives', async ({ page }) => {
    const problems = await watchProblems(page);
    await fakeChat(page, { latencyMs: 50, speed: 2 });
    await open(page, { name: 'chat-new', path: NEW_CHAT });
    await ask(page, PROMPT);

    const answer = page.locator('[data-slot=chat-message][data-role=agent]').last();
    await expect(answer).toHaveAttribute('data-streaming', 'true', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Stop' }).click();

    await expect(page.locator('[data-notice=cancelled]')).toBeVisible();
    await expect(answer).not.toHaveAttribute('data-streaming', 'true');
    const lengths = await sampleAnswer(page, 4, 150);
    expect(new Set(lengths).size, `answer lengths after Stop ${lengths.join(', ')}`).toBe(1);
    expect(await answer.textContent()).not.toContain('calm opening shot');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    expect(problems).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`tabbing through the composer shows a focus ring on every control (${theme})`, async ({ page }) => {
      await preferences(page, { theme });
      await fakeChat(page, { latencyMs: 50 });
      await open(page, { name: 'chat-new', path: NEW_CHAT });
      const box = page.getByRole('textbox', { name: 'Message Taalcut' });
      // Text in the box, so Send is enabled and in the tab order.
      await box.fill('Make a 20 second reel from Goa');
      await box.focus();

      // The text box: the ring is on the bar around it (the box itself has no outline).
      const barRing = await box.evaluate((textarea) => {
        for (let node = textarea.parentElement; node; node = node.parentElement) {
          const shadow = getComputedStyle(node).boxShadow;
          if (shadow && shadow !== 'none') return shadow;
          if (node.matches('[data-slot=composer]')) break;
        }
        return 'none';
      });
      expect(barRing, 'the bar shows a ring while the text box has focus').not.toBe('none');

      // Every other control: Tab to it and read the outline the page actually draws.
      const focus = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--color-focus)';
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      });
      const visited: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Tab');
        const ring = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element?.closest('[data-slot=composer]')) return null;
          const style = getComputedStyle(element);
          return {
            name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
            style: style.outlineStyle,
            width: parseFloat(style.outlineWidth),
            colour: style.outlineColor,
          };
        });
        if (!ring) break;
        visited.push(ring.name);
        expect(ring.style, `${ring.name}: outline style`).toBe('solid');
        expect(ring.width, `${ring.name}: outline width`).toBeGreaterThanOrEqual(2);
        expect(ring.colour, `${ring.name}: outline colour`).toBe(focus);
      }
      // The model button, the thinking button, Recipes (P3-V11), Effects (UX2-GSAP) and Send (attachments and
      // dictation are hidden: nothing behind them yet).
      expect(visited).toEqual([
        expect.stringMatching(/^Model:\s*GPT-6\.1 Sol/),
        expect.stringMatching(/^Thinking:\s*Medium/),
        'Recipes',
        'Effects',
        'Send',
      ]);
      await screenshotWhole(page, `screenshots/${theme}/composer-focus.png`);
    });
  }

  test('Stop during a tool marks it stopped and skips the rest of the plan', async ({ page }) => {
    await fakeChat(page, { latencyMs: 50, speed: 1 });
    await open(page, { name: 'chat-new', path: NEW_CHAT });
    await ask(page, PROMPT);

    const running = page.locator('[data-card-type=toolRun][data-status=running]');
    await expect(running).toHaveCount(1, { timeout: 10_000 });
    await page.getByRole('button', { name: 'Stop' }).click();

    await expect(page.locator('[data-card-type=toolRun][data-status=cancelled]')).toHaveCount(1);
    await expect(page.locator('[data-card-type=toolRun][data-status=running]')).toHaveCount(0);
    await expect(page.locator('[data-card-type=plan] li[data-step-status=skipped]')).not.toHaveCount(0);
    await expect(page.locator('[data-slot=chat-message][data-role=agent]')).toHaveCount(0);
  });

  test('answering a question goes through the client and updates the card', async ({ page }) => {
    await fakeChat(page, { latencyMs: 50 });
    await open(page, { name: 'chat-conversation', path: SEEDED });
    await page.getByRole('link', { name: /Product teaser/ }).click();
    const approval = page.locator('[data-card-type=approval]');
    await approval.getByRole('button', { name: 'Go ahead' }).click();
    // The agent updates the card in place: no more buttons on it. Success is silent (no toast).
    await expect(approval).toHaveAttribute('data-status', 'approved');
    await expect(approval.getByRole('button', { name: 'Go ahead' })).toHaveCount(0);
    await expect(page.locator('[data-notice=paused]')).toHaveCount(0);
    await expect(page.locator('[data-slot=toast]')).toHaveCount(0);
  });

  test('Always allow on an upload consent sends remember, and the run carries on live', async ({ page }) => {
    await fakeChat(page, { latencyMs: 50 });
    await open(page, { name: 'chat-conversation', path: '/chat/01K7C5M6Q8R9S0T1V2W3X4Y5Z6' });
    const consent = page.locator('[data-card-type=consent]');
    await expect(consent).toHaveCount(1);
    const replies = page.locator('[data-slot=chat-message][data-role=agent]');
    const before = await replies.count();
    await consent.getByRole('button', { name: 'Always allow' }).click();
    // The one result you can't see (next time) is said on the card itself.
    await expect(
      consent.getByText('Taalcut won’t ask again before sending files for this.', { exact: true }),
    ).toBeVisible();
    // Settled in place, and the resumed run streams in without a reload.
    await expect(consent).toHaveAttribute('data-status', 'approved');
    await expect(consent.getByRole('button', { name: 'Always allow' })).toHaveCount(0);
    await expect(replies).toHaveCount(before + 1);
    // The fake agent's reply depends on `remember`: it arrived with the answer.
    await expect(replies.last()).toContainText('I won’t ask again', { timeout: 10_000 });
    // Nothing waits any more (the cost question was answered "Not now" by the message after it).
    await expect(page.locator('[data-notice=paused]')).toHaveCount(0);
  });

  test('Stop ends a run that waits for an answer, by id, with no stream on screen', async ({ page }) => {
    await fakeChat(page, { latencyMs: 50 });
    await open(page, { name: 'chat-conversation', path: SEEDED });
    // The seeded run was left waiting (as after a reload). The composer stays free (a new message answers
    // "Not now"); its one waiting line offers Stop for that run.
    const waiting = page.locator('[data-notice=paused]');
    await expect(waiting).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    await waiting.getByRole('button', { name: 'Stop' }).click();
    // The run's final status, in place of "waiting"; its question can't be answered any more.
    await expect(page.locator('[data-notice=cancelled]')).toHaveCount(1);
    await expect(waiting).toHaveCount(0);
    await expect(page.locator('[data-card-type=consent]')).toHaveAttribute('data-status', 'expired');
    await expect(page.getByRole('button', { name: 'Allow once' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    // The fake stored the cancel: reopening shows the same.
    await page.getByRole('link', { name: /Diwali highlights/ }).click();
    await page.getByRole('link', { name: /Trip to Goa reel/ }).click();
    await expect(page.locator('[data-notice=cancelled]')).toHaveCount(1);
  });

  test('an answer to a run that had already ended is a calm note, not an error', async ({ page }) => {
    await fakeChat(page, { latencyMs: 50 });
    await open(page, { name: 'chat-conversation', path: SEEDED });
    // Another window stops the consent's run while this one still shows the question.
    await page.evaluate(async (id) => {
      type Event = { type: string; payload: { runId: string; card?: { type: string } } };
      type Chat = {
        getConversation(id: string): Promise<{ ok: boolean; value: { history: Event[] } }>;
        stop(runId: string): Promise<unknown>;
      };
      const chat = (window as unknown as { taalcutFakeChat?: Chat }).taalcutFakeChat;
      const record = await chat?.getConversation(id);
      if (!chat || !record?.ok) throw new Error('no fake chat');
      for (const event of record.value.history) {
        if (event.type === 'agent.card' && event.payload.card?.type === 'consent')
          await chat.stop(event.payload.runId);
      }
    }, SEEDED_ID);
    const consent = page.locator('[data-card-type=consent]');
    await consent.getByRole('button', { name: 'Allow once' }).click();
    await expect(page.locator('[data-notice=ended]')).toBeVisible();
    await expect(consent).toHaveAttribute('data-status', 'expired');
    await expect(page.locator('[data-notice=paused]')).toHaveCount(0);
    await expect(page.locator('[data-slot=error-card]')).toHaveCount(0);
    await expect(page.getByText("Couldn't send your answer")).toHaveCount(0);
  });

  test("an error's fix is confirmed in place when it works, without a toast", async ({ page }) => {
    const problems = await watchProblems(page);
    await fakeChat(page, { latencyMs: 50 });
    await open(page, { name: 'chat', path: '/chat' });
    await page.getByRole('link', { name: /Diwali highlights/ }).click();
    const line = page.locator('[data-card-type=error] [data-slot=error-line]');
    // One line in the chat, naming the thing that went missing (DESIGN.md v0.2: not a card).
    await expect(line).toContainText('That folder is no longer here.');
    await page.getByRole('button', { name: 'Choose another folder' }).click();
    await expect(line).toHaveText('Choose another folder: done');
    await expect(page.locator('[data-card-type=error] [data-slot=error-card]')).toHaveCount(0);
    await expect(page.getByText('Done: Choose another folder', { exact: true })).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('a fix that fails says why in place, with its own fix', async ({ page }) => {
    await fakeChat(page, { latencyMs: 50, failCommands: ['sources.choose'] });
    await open(page, { name: 'chat', path: '/chat' });
    await page.getByRole('link', { name: /Diwali highlights/ }).click();
    await page.getByRole('button', { name: 'Choose another folder' }).click();
    const line = page.locator('[data-card-type=error] [data-slot=error-line]');
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('This took too long and was stopped.');
  });

  test('the start surface sends a first message and the chat follows it to the end', async ({ page }) => {
    const problems = await watchProblems(page);
    await fakeChat(page, { latencyMs: 50, speed: 3 });
    await open(page, { name: 'chat', path: '/chat' });
    const starter = 'Add my Trip folder and describe the first video';
    await ask(page, starter);
    await expect(page).toHaveURL(/\/chat\/[0-9A-Z]{26}$/);
    await expect(page.locator('[data-slot=chat-message][data-role=user]')).toContainText(starter);
    // Typing goes on in the new chat's composer.
    await expect(page.getByRole('textbox', { name: 'Message Taalcut' })).toBeFocused();
    const answer = page.locator('[data-slot=chat-message][data-role=agent]').last();
    await expect(answer).toContainText('a beach at sunset', { timeout: 15_000 });
    // Pinned to the end while it grew: the answer sits above the composer, no "Jump to latest".
    await expect(answer).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('a long chat stays at its end while a run grows it; scrolling up lets go', async ({ page }) => {
    await fakeChat(page, { latencyMs: 30, speed: 0.6 });
    // Opened from the list (in the page, as people do), where the browser's scroll anchoring kicks in.
    await open(page, { name: 'chat', path: '/chat' });
    await page
      .getByRole('navigation', { name: 'Chats' })
      .getByRole('link', { name: /Trip to Goa reel/ })
      .click();
    await expect(page.locator('[data-slot=chat-message]').first()).toBeVisible();
    await ask(page, PROMPT);
    const jump = page.getByRole('button', { name: 'Jump to latest' });
    // Cards, steps and the working line arrive in steps taller than the slack: none may unpin it.
    for (let i = 0; i < 8; i += 1) {
      await page.waitForTimeout(400);
      await expect(jump).toHaveCount(0);
    }
    await page.mouse.move(640, 300);
    await page.mouse.wheel(0, -600);
    await expect(jump).toBeVisible();
  });

  test('a title the agent writes reaches the window bar and the chat list live', async ({ page }) => {
    const problems = await watchProblems(page);
    await fakeChat(page, { latencyMs: 50 });
    await open(page, { name: 'chat-conversation', path: SEEDED });
    const bar = page.locator('[data-slot=window-title]');
    await expect(bar).toContainText('Trip to Goa reel');
    // Marks a transcript element: if the page reloaded the chat, the mark would be gone.
    await page
      .locator('[data-slot=chat-message]')
      .first()
      .evaluate((node) => node.setAttribute('data-kept', ''));

    await page.evaluate((id) => {
      type Fakes = {
        taalcutFakeChat?: { rename(id: string, title: string): boolean };
        taalcutFake?: { events: { emit(type: string, payload: unknown): void } };
      };
      const fakes = window as unknown as Fakes;
      fakes.taalcutFakeChat?.rename(id, 'Goa sunset cut');
      fakes.taalcutFake?.events.emit('library.changed', {
        projectId: null,
        entity: 'conversation',
        change: 'updated',
        ids: [id],
      });
    }, SEEDED_ID);

    await expect(page.getByRole('heading', { level: 1, name: /Goa sunset cut/ })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Recent chats' }).getByRole('link', { name: /Goa sunset cut/ }),
    ).toBeVisible();
    // The old title faded out and is gone; the transcript was never reloaded.
    await expect(bar).not.toContainText('Trip to Goa reel');
    await expect(page.locator('[data-kept]')).toHaveCount(1);
    expect(problems).toEqual([]);
  });

  test('a reel link sends at once, with no warning card', async ({ page }) => {
    const problems = await watchProblems(page);
    await fakeChat(page, { latencyMs: 50, speed: 0 });
    await open(page, { name: 'chat-new', path: NEW_CHAT });
    const link = 'Copy the style of https://www.instagram.com/reel/EXAMPLE123/';
    await ask(page, link);

    // REF1: nothing holds a reel's link; it is your message straight away, and so is the next one.
    await expect(page.locator('[data-slot=chat-message][data-role=user]')).toContainText(link);
    await expect(page.locator('[data-slot=warning-card]')).toHaveCount(0);
    await ask(page, 'And this one https://youtu.be/EXAMPLE456');
    await expect(page.locator('[data-slot=chat-message][data-role=user]')).toHaveCount(2);
    await expect(page.locator('[data-slot=warning-card]')).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});
