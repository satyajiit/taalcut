// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, type Locator, type Page, test } from '@playwright/test';
import { AI_STORIES, CHATGPT_STICKERS, STORIES } from '../../src/content/ai-stories';
import { YOUR_AI_SECTION } from '../../src/content/home';
import { API_KEYS, CHATGPT, OWN_SERVER, PROVIDERS } from '../../src/content/providers';

/**
 * AI1 lane S: every AI as a story. /ai/'s providers are a stories tray and a viewer, the ChatGPT window plays under its
 * segment bar, and the home's Your AI is the compact form with a working Local only switch.
 */

const story = (scope: Locator) => scope.locator('[data-slot="story-stage"] [data-slot="story"]');

/** Brings the stage on screen and waits for the page to hydrate (the tray's buttons answer). */
async function stage(page: Page, path: string, section: string) {
  await page.goto(path);
  const s = page.locator(section);
  await s.locator('[data-slot="story-stage"]').scrollIntoViewIfNeeded();
  await expect(story(s)).toHaveCount(1);
  return s;
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  for (const [path, section] of [
    ['/ai/', '#providers'],
    ['/', '#your-ai'],
  ] as const) {
    test(`${path} holds every AI’s story, finished, with every fact in the page`, async ({ page }) => {
      await page.goto(path);
      const s = page.locator(section);
      await expect(s.locator('[data-slot="story"]')).toHaveCount(AI_STORIES.length);
      for (const p of PROVIDERS) {
        const frame = s.locator(`[data-slot="story"][data-story="${p.id}"]`);
        await expect(frame.locator('[data-fact]'), p.id).toHaveCount(AI_STORIES.find((x) => x.id === p.id)!.segments.length);
      }
      for (const words of [...PROVIDERS.filter((p) => p.way !== 'on-device').map((p) => p.does), API_KEYS.cap[0], 'You never need one: Taalcut already runs models on your computer.']) {
        await expect(s.getByText(words, { exact: false }).first(), words).toBeVisible();
      }
      expect(OWN_SERVER.lead).toContain('You never need one');
      // The row scrolls inside itself; the page never does.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('/ai/’s stories', () => {
  test('play once on arrival, then rest finished', async ({ page }) => {
    const s = await stage(page, '/ai/', '#providers');
    const open = story(s);
    await expect(open).toHaveAttribute('data-story', 'openai');
    await expect(open).toHaveAttribute('data-playing', 'true');
    await expect(open).not.toHaveAttribute('data-playing', { timeout: 6_000 });
    await expect(open).toHaveAttribute('data-at', '3');
    await expect(open.locator('[data-fact]')).toHaveCount(4);
  });

  test('a tap in the tray opens that AI’s story, which plays', async ({ page }) => {
    const s = await stage(page, '/ai/', '#providers');
    const ollama = s.getByRole('button', { name: 'Ollama', exact: true });
    await expect(async () => {
      await ollama.click({ timeout: 1000 });
      await expect(story(s)).toHaveAttribute('data-story', 'ollama', { timeout: 500 });
    }).toPass();
    await expect(ollama).toHaveAttribute('aria-pressed', 'true');
    await expect(s.getByRole('button', { name: 'OpenAI', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(story(s).getByText('Ollama', { exact: true })).toBeVisible();
    await expect(story(s)).toHaveAttribute('data-at', '1', { timeout: 6_000 });
    await expect(story(s).getByText(PROVIDERS.find((p) => p.id === 'ollama')!.does)).toBeVisible();
  });

  test('Previous, Next and the arrow keys step through the facts, then on to the next story', async ({ page }) => {
    const s = await stage(page, '/ai/', '#providers');
    const open = story(s);
    await expect(open).toHaveAttribute('data-at', '3', { timeout: 6_000 });
    await open.getByRole('button', { name: STORIES.previous }).click();
    await expect(open).toHaveAttribute('data-at', '2');
    await expect(open.locator('[data-fact]')).toHaveCount(3);
    await page.keyboard.press('ArrowLeft');
    await expect(open).toHaveAttribute('data-at', '1');
    await page.keyboard.press('ArrowRight');
    await expect(open).toHaveAttribute('data-at', '2');
    await expect(s.getByText(STORIES.status(3, 4, 'Your keychain'))).toHaveCount(1);
    await open.getByRole('button', { name: STORIES.next }).click();
    await expect(open).toHaveAttribute('data-at', '3');
    // Next on the last fact opens the next story.
    await story(s).getByRole('button', { name: STORIES.next }).click();
    await expect(story(s)).toHaveAttribute('data-story', 'anthropic');
  });

  test('plays again on request', async ({ page }) => {
    const s = await stage(page, '/ai/', '#providers');
    await expect(story(s)).not.toHaveAttribute('data-playing', { timeout: 6_000 });
    await story(s).getByRole('button', { name: STORIES.replay }).click();
    await expect(story(s)).toHaveAttribute('data-playing', 'true');
    await expect(story(s)).toHaveAttribute('data-at', '0');
  });

  test('ChatGPT’s story links up to its demo', async ({ page }) => {
    const s = await stage(page, '/ai/', '#providers');
    await expect(async () => {
      await s.getByRole('button', { name: 'ChatGPT', exact: true }).click({ timeout: 1000 });
      await expect(story(s)).toHaveAttribute('data-story', 'chatgpt', { timeout: 500 });
    }).toPass();
    await expect(story(s).getByRole('link', { name: STORIES.chatgptLink })).toHaveAttribute('href', '#chatgpt');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the tray scrolls inside itself, a tap on the story’s right side steps on, and the page never scrolls sideways', async ({ page }) => {
    const s = await stage(page, '/ai/', '#providers');
    const tray = s.locator('[data-slot="story-tray"]');
    expect(await tray.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await tray.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect.poll(() => tray.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const open = story(s);
    await expect(open).toHaveAttribute('data-at', '3', { timeout: 6_000 });
    const box = (await open.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.15, box.y + box.height * 0.85);
    await expect(open).toHaveAttribute('data-at', '2');
    await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height * 0.85);
    await expect(open).toHaveAttribute('data-at', '3');
  });

  test('the home’s Your AI is never taller than 1.3 screens, and no word is under 11 px', async ({ page }) => {
    await page.goto('/');
    const s = page.locator('section#your-ai');
    await s.scrollIntoViewIfNeeded();
    const box = (await s.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(844 * 1.3);
    const small = await s.evaluate((el) =>
      [...el.querySelectorAll('*')]
        .filter((n) => n.childNodes.length > 0 && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim()))
        .filter((n) => n.getClientRects().length > 0 && parseFloat(getComputedStyle(n).fontSize) < 11)
        .map((n) => n.textContent),
    );
    expect(small).toEqual([]);
  });
});

test.describe('the home’s Your AI', () => {
  test('is shorter at 1440 than the wall it replaced (806 px)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const box = (await page.locator('section#your-ai').boundingBox())!;
    expect(box.height).toBeLessThan(806);
  });

  test('Local only pauses the cloud AIs and opens what runs on your computer', async ({ page }) => {
    const s = await stage(page, '/', '#your-ai');
    await expect(story(s)).toHaveAttribute('data-story', 'chatgpt');
    await expect(story(s).getByRole('link', { name: STORIES.chatgptLink })).toHaveAttribute('href', '/ai/#chatgpt');
    const toggle = s.getByRole('switch', { name: new RegExp(YOUR_AI_SECTION.local.label) });
    await expect(async () => {
      await toggle.click({ timeout: 1000 });
      await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 500 });
    }).toPass();
    const label = s.locator('[data-slot="paused-label"]');
    await expect(label).toHaveText(YOUR_AI_SECTION.local.paused);
    // A status line, never a sticker (DESIGN.md: the Sticker Is Never State Rule): level, on the headers' row, clear of
    // every avatar.
    await expect(s.locator('[data-slot="story-tray"] [data-slot="sticker"]')).toHaveCount(0);
    expect(await label.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    const under = (await label.boundingBox())!;
    for (const id of ['chatgpt', 'openai', 'anthropic', 'google']) {
      const avatar = (await s.locator(`[data-story-tab="${id}"] [data-slot="story-avatar"]`).boundingBox())!;
      expect(under.y + under.height, id).toBeLessThanOrEqual(avatar.y);
    }
    for (const p of PROVIDERS) {
      const ring = s.locator(`[data-story-tab="${p.id}"] [data-slot="story-avatar"]`);
      await expect(ring, p.id).toHaveAttribute('data-ring', p.way === 'subscription' || p.way === 'api-key' ? 'paused' : p.way === 'on-device' ? 'you' : 'server');
    }
    await expect(story(s)).toHaveAttribute('data-story', 'on-device');
    await expect(s.getByRole('button', { name: /Taalcut’s own models/ })).toHaveAttribute('aria-pressed', 'true');
    await toggle.press('Space');
    await expect(s.locator('[data-slot="paused-label"]')).toHaveCount(0);
    await expect(s.locator('[data-story-tab="openai"] [data-slot="story-avatar"]')).toHaveAttribute('data-ring', 'ai');
  });
});

test.describe('Continue with ChatGPT', () => {
  test('plays its three steps once on arrival, then rests signed in with both stickers on the window', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/ai/');
    const s = page.locator('section#chatgpt');
    const steps = s.getByRole('list', { name: CHATGPT_STICKERS.steps });
    await steps.scrollIntoViewIfNeeded();
    await expect(steps.getByRole('button', { name: /Accounts/ })).toHaveAttribute('aria-current', 'step');
    await expect(steps.getByRole('button', { name: /Your plan/ })).toHaveAttribute('aria-current', 'step', { timeout: 5_000 });
    await expect(s.getByText(CHATGPT_STICKERS.password, { exact: true })).toBeVisible();
    await expect(s.getByText(CHATGPT_STICKERS.bill, { exact: true })).toBeVisible();
    for (const [label] of CHATGPT.facts.slice(2)) await expect(s.getByText(`${label}.`)).toBeVisible();
    // Each step carries its facts: Accounts says what it uses.
    await steps.getByRole('button', { name: /Accounts/ }).click();
    await expect(s.getByText(CHATGPT.facts[1]![1])).toBeVisible();
    await expect(s.getByText(CHATGPT_STICKERS.bill, { exact: true })).toHaveCount(0);
  });

  test.describe('under reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('every story and the window show their finished state, with nothing to play again', async ({ page }) => {
      await page.goto('/ai/');
      const s = page.locator('#providers');
      await s.locator('[data-slot="story-stage"]').scrollIntoViewIfNeeded();
      await expect(story(s)).toHaveAttribute('data-at', '3');
      await expect(s.getByRole('button', { name: STORIES.replay })).toHaveCount(0);
      await expect(async () => {
        await s.getByRole('button', { name: 'Anthropic', exact: true }).click({ timeout: 1000 });
        await expect(story(s)).toHaveAttribute('data-story', 'anthropic', { timeout: 500 });
      }).toPass();
      await expect(story(s)).toHaveAttribute('data-at', '3');
      await expect(story(s).locator('[data-fact]')).toHaveCount(4);
      await expect(page.locator('section#chatgpt').getByText(CHATGPT.row.plan, { exact: true })).toBeVisible();
    });
  });
});
