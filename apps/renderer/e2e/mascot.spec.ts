// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Kaatu, the mascot (DESIGN.md, Mascot): where it appears and at what size, its
// mood following the agent's run, reduced motion, and axe on the working line.
// The companion at the sidebar's foot and the first-visit tip are in kaatu-companion.spec.ts (UX4).
// Screenshots of every place it sits, light and dark, at 1280x800 and 960x600,
// land in e2e-artifacts/screenshots/mascot/.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { describeViolation, gated, scan } from './axe.ts';
import { ARTIFACTS, fakeChat, open, preferences, watchProblems } from './support.ts';

const NEW_CHAT = '/chat/01K7C5M6Q8R9S0T1V2W3X4YZZZ';
const SEEDED = '/chat/01K7C5M6Q8R9S0T1V2W3X4Y5Z6';
const PROMPT = "Add my Desktop/Trip folder and tell me what's in the first video";

/** Each place Kaatu sits, the page that shows it, and its size there (MASCOT_SIZES). */
const PLACES = [
  { name: 'chat-start', path: NEW_CHAT, spot: 'hero', size: 88 },
  { name: 'make-empty', path: '/projects', spot: 'empty', size: 64 },
  { name: 'exports-empty', path: '/renders', spot: 'empty', size: 64 },
  { name: 'library-empty', path: '/library', spot: 'empty', size: 64 },
  { name: 'templates-empty', path: '/templates', spot: 'empty', size: 64 },
  { name: 'settings-about', path: '/settings/about', spot: 'about', size: 112 },
  // UX4: off the rail; each step's Kaatu is its moment, under the heading.
  { name: 'onboarding-step', path: '/onboarding/sources', spot: 'moment', size: 48 },
  { name: 'onboarding-welcome', path: '/onboarding', spot: 'hero', size: 88 },
  { name: 'not-found', path: '/no-such-page', spot: 'message', size: 80 },
] as const;

/** The page's own Kaatu: the companion at the sidebar's foot is counted on its own (kaatu-companion.spec.ts). */
const mascots = (page: Page) => page.locator('[data-slot=mascot]:not([data-slot=companion] *)');
/** Frames that only an antic shows. */
const ANTIC_FRAMES = /snack|chomp|yawn|wave|curious|bop|cheeky|wink|clap/;
/** The sprite: inside the breath's span (UX4: the breath is a CSS animation of its own, on the compositor). */
const sprite = (mascot: Locator) => mascot.locator('[data-slot=mascot-breath] > span').first();
const workingLine = (page: Page) => page.locator('[data-slot=chat-working]');

async function ask(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'Message Taalcut' });
  await box.fill(text);
  await box.press('Enter');
}

/** What Kaatu shows, sampled over a few seconds: the face when there is one, else where it looks. */
async function looks(mascot: Locator, samples: number, everyMs: number): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < samples; i += 1) {
    const face = await sprite(mascot).getAttribute('data-reaction');
    seen.push(face ?? (await sprite(mascot).getAttribute('data-direction')) ?? '');
    await mascot.page().waitForTimeout(everyMs);
  }
  return seen;
}

test.describe('Kaatu', () => {
  test.beforeEach(async ({ page }) => {
    await preferences(page, { locale: 'en', theme: 'light' });
    // Kaatu sits on the empty Make, Library and Templates: the fakes start with none of them.
    await fakeChat(page, { latencyMs: 50, library: 'empty', templates: 'empty', projects: 'empty' });
  });

  for (const place of PLACES) {
    test(`sits on ${place.name} at ${place.size} px, decorative or named`, async ({ page }) => {
      const problems = await watchProblems(page);
      await open(page, { name: place.name, path: place.path });
      const mascot = mascots(page);
      await expect(mascot).toHaveCount(1);
      await expect(mascot).toHaveAttribute('data-spot', place.spot);
      expect((await mascot.boundingBox())?.width).toBe(place.size);
      // Its sheets load (served from the app itself, so the CSP allows them).
      const loaded = await sprite(mascot).evaluate((el) =>
        [...el.querySelectorAll(':scope > span > span')].map(
          (layer) => getComputedStyle(layer).backgroundImage,
        ),
      );
      expect(loaded).toHaveLength(6);
      expect(
        loaded.every((url) => /kaatu-(directions|blinks|glances|reactions|antics|tricks).*\.webp/.test(url)),
      ).toBe(true);
      // Never a control: nothing to tab to, nothing a screen reader announces as a button.
      await expect(mascot.locator('button, [tabindex]')).toHaveCount(0);
      if (place.spot === 'about')
        await expect(page.getByRole('img', { name: 'Kaatu, Taalcut’s beaver' })).toBeVisible();
      else await expect(sprite(mascot)).toHaveAttribute('aria-hidden', 'true');
      expect(problems).toEqual([]);
    });
  }

  // The welcome has its hero now (UX4: first run's moments), so it left this list; mascot places cover it.
  test('stays out of the way: not in settings or a chat with messages', async ({ page }) => {
    for (const path of ['/settings/models', SEEDED]) {
      await open(page, { name: path, path });
      await expect(page.locator('h1').first()).toBeVisible();
      await expect(mascots(page)).toHaveCount(0);
    }
  });

  test('never stops: with nobody touching anything it keeps breathing and gets up to antics', async ({
    page,
  }) => {
    await open(page, { name: 'renders', path: '/renders' });
    const mascot = mascots(page);
    await expect(mascot).toHaveAttribute('data-breathing', 'true');
    // An antic comes along on its own (the first within nine seconds, though "look around"
    // uses only head turns, so allow for the one after it).
    await expect(sprite(mascot)).toHaveAttribute('data-frame', ANTIC_FRAMES, { timeout: 30_000 });
    // Still moving: the breath is a loop that never settles, a CSS animation of transform (the compositor's).
    const breath = mascot.locator('[data-slot=mascot-breath]');
    const moving = await breath.evaluate(async (el) => {
      const first = getComputedStyle(el).transform;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const names = el.getAnimations().map((a) => (a as CSSAnimation).animationName);
      return first !== getComputedStyle(el).transform && names.includes('tc-kaatu-breath');
    });
    expect(moving).toBe(true);
  });

  test('turns to the pointer on the chat start, and a poke gets a reaction', async ({ page }) => {
    await open(page, { name: 'chat-new', path: NEW_CHAT });
    const mascot = mascots(page);
    const box = (await mascot.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(5, box.y + box.height / 2, { steps: 4 });
    await expect(sprite(mascot)).toHaveAttribute('data-direction', 'left');
    await page.mouse.move(box.x + box.width / 2, 790, { steps: 4 });
    await expect(sprite(mascot)).toHaveAttribute('data-direction', 'down');
    // A pointer click where Kaatu is (it breathes, so it never holds still for an element click).
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(sprite(mascot)).toHaveAttribute('data-reaction', /content|heart/);
  });

  test('the mood follows the run: thinking while it goes, a grin when it ends well, then gone', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await fakeChat(page, { latencyMs: 50, speed: 0.75 });
    await open(page, { name: 'chat-new', path: NEW_CHAT });
    await expect(mascots(page)).toHaveAttribute('data-spot', 'hero');
    await ask(page, PROMPT);

    // The start surface (and its Kaatu) goes; the working line takes over, small, at the transcript's foot.
    const line = workingLine(page);
    await expect(line).toHaveAttribute('data-mood', 'thinking');
    await expect(page.locator('[data-spot=hero]')).toHaveCount(0);
    const mascot = line.locator('[data-slot=mascot]');
    expect((await mascot.boundingBox())?.width).toBe(32);
    await expect(page.getByRole('status').filter({ hasText: 'Working on it…' })).toHaveCount(1);
    // Thinking: a look up to one side, then a nibble, a beat a second.
    const seen = await looks(mascot, 7, 300);
    expect(new Set(seen).size, `beats ${seen.join(', ')}`).toBeGreaterThan(1);
    expect(seen, `beats ${seen.join(', ')}`).toContain('nibble');
    expect(
      seen.every((beat) => beat === 'nibble' || beat.startsWith('up')),
      `beats ${seen.join(', ')}`,
    ).toBe(true);
    // No breath in the working line: the look-and-nibble is the loader.
    await expect(mascot).not.toHaveAttribute('data-breathing', 'true');

    await expect(line).toHaveAttribute('data-mood', 'happy', { timeout: 30_000 });
    await expect(sprite(mascot)).toHaveAttribute('data-reaction', 'delighted');
    await expect(line).toHaveCount(0, { timeout: 5_000 });
    expect(problems).toEqual([]);
  });

  test('Stop: the working line just goes, without a grin', async ({ page }) => {
    await fakeChat(page, { latencyMs: 50, speed: 0.5 });
    await open(page, { name: 'chat-new', path: NEW_CHAT });
    await ask(page, PROMPT);
    await expect(workingLine(page)).toHaveAttribute('data-mood', 'thinking');
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.locator('[data-notice=cancelled]')).toBeVisible();
    await expect(workingLine(page)).toHaveCount(0);
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('no breath and no squash; the thinking look-around keeps going, slower', async ({ page }) => {
      await fakeChat(page, { latencyMs: 50, speed: 0.5 });
      await open(page, { name: 'chat-new', path: NEW_CHAT });
      const hero = mascots(page);
      await expect(hero).not.toHaveAttribute('data-breathing', 'true');
      // Nothing moves; a blink may crossfade a face, which the base layer allows.
      const still = await hero.evaluate(async (el) => {
        const first = getComputedStyle(el).transform;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const moving = el
          .getAnimations({ subtree: true })
          .filter((a) => !(a instanceof CSSTransition && a.transitionProperty === 'opacity'));
        return first === getComputedStyle(el).transform && moving.length === 0;
      });
      expect(still).toBe(true);
      // A poke changes the face with the base layer's 150 ms fade, and nothing else moves:
      // no squash, and no slide of the sheet between frames.
      await hero.click();
      await expect(sprite(hero)).toHaveAttribute('data-reaction', 'heart');
      const moving = await hero.evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => !(a instanceof CSSTransition && a.transitionProperty === 'opacity')).length,
      );
      expect(moving).toBe(0);

      await ask(page, PROMPT);
      const mascot = workingLine(page).locator('[data-slot=mascot]');
      await expect(workingLine(page)).toHaveAttribute('data-mood', 'thinking');
      const seen = await looks(mascot, 6, 700);
      expect(new Set(seen).size, `looks ${seen.join(', ')}`).toBeGreaterThan(1);
    });
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe: the working line mid-run and About (${theme})`, async ({ page }, testInfo) => {
      await preferences(page, { theme });
      // The run holds once its first tool has finished: mid-run, with the plan and a finished call on screen and
      // nothing arriving while axe reads the page. (Left running, the next tool's row could be read mid-fade.)
      await fakeChat(page, { latencyMs: 50, speed: 0.4, holdAfter: 'agent.toolFinished' });
      await open(page, { name: 'chat-new', path: NEW_CHAT });
      await ask(page, PROMPT);
      await expect(workingLine(page)).toHaveAttribute('data-mood', 'thinking');
      await expect(page.locator('[data-card-type=plan]')).toBeVisible();
      await expect(page.locator('[data-slot=tool-run][data-status=succeeded]')).toHaveCount(1, {
        timeout: 15_000,
      });
      await expect(workingLine(page)).toHaveAttribute('data-mood', 'thinking');
      const scans = [await scan(page, `Kaatu at work, chat (${theme})`)];
      await open(page, { name: 'settings-about', path: '/settings/about' });
      scans.push(await scan(page, `Kaatu, About (${theme})`));
      const blocking = scans.flatMap((results) => gated(results)).map(describeViolation);
      await testInfo.attach('violations', { body: blocking.join('\n'), contentType: 'text/plain' });
      expect(blocking).toEqual([]);
    });
  }
});

/** Screenshots for review: every place, both themes, both window sizes. */
test.describe('Kaatu screenshots', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const size of [
      { width: 1280, height: 800 },
      { width: 960, height: 600 },
    ]) {
      test(`${theme} ${size.width}x${size.height}`, async ({ page }) => {
        test.slow();
        const dir = `screenshots/mascot/${theme}-${size.width}x${size.height}`;
        const shot = (name: string) =>
          page.screenshot({
            path: new URL(`${dir}/${name}.png`, ARTIFACTS).pathname,
            animations: 'disabled',
          });
        await page.setViewportSize(size);
        await preferences(page, { theme, locale: 'en' });
        await fakeChat(page, {
          latencyMs: 50,
          speed: 0.4,
          library: 'empty',
          templates: 'empty',
          projects: 'empty',
        });
        for (const place of PLACES) {
          await open(page, { name: place.name, path: place.path });
          await expect(mascots(page)).toHaveCount(1);
          await shot(place.name);
        }
        await open(page, { name: 'chat-new', path: NEW_CHAT });
        await ask(page, PROMPT);
        await expect(page.locator('[data-card-type=plan]')).toBeVisible();
        await expect(workingLine(page)).toHaveAttribute('data-mood', 'thinking');
        await shot('chat-working-line');
        await open(page, { name: 'dev-kit', path: '/dev/kit' });
        await page.locator('[data-slot=mascot-preview]').scrollIntoViewIfNeeded();
        await page
          .locator('[data-slot=mascot-preview]')
          .screenshot({ path: new URL(`${dir}/kit-moods.png`, ARTIFACTS).pathname, animations: 'disabled' });
      });
    }
  }
});
