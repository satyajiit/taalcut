// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The media cards (P3-B6 voiceover and voice consent, P3-V13 motion graphic, P3-B7 image takes) as the kit shows
// them on the fake's Golden hour timelines with their voiceovers, graphics and image slots on (`media: { arranged:
// true }`): every state is a real card (none a placeholder) with its state's words, axe is clean on the cards in
// light and dark, ducking and Remove voiceover work by keyboard and undo against the fake, and in the
// pseudo-locale nothing is English or cut off in a 360 px column. Screens go to the lane's media folder.
import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { axeFor, expectAccessible } from './axe.ts';
import { englishPhrases, englishShowing, untranslated, type Finding } from './inspect.ts';
import { ARTIFACTS, FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';
import { fakeCall } from './wire-watch.ts';

const KIT = { name: 'dev-kit', path: '/dev/kit' };
/** The Golden hour project the media fixtures' timelines are in (MEDIA_FIXTURE_IDS.project). */
const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA';
const SCREENS = process.env.TAALCUT_MEDIA_SCREENS ?? new URL('screenshots/media/', ARTIFACTS).pathname;

const STATES = {
  voiceover: ['draft', 'your voice, mixed', 'final, no music'],
  voiceConsent: ['ready', 'recording', 'checking', 'mismatch', 'stored', 'cloned', 'failed'],
  motionGraphic: ['half the stalls, placed by time', 'shopping list', 'name card', 'ring on the stall'],
  imageTakes: ['one', 'four, slot still a gap', 'two'],
} as const;
const NAMES = Object.entries(STATES).flatMap(([type, states]) => states.map((state) => `${type} · ${state}`));
/** Each card's state, in words or a control, as its fixture shows it. */
const SHOWS: Record<string, string> = {
  'voiceover · draft': 'Off the beat',
  'voiceover · your voice, mixed': 'Draft and final',
  'voiceover · final, no music': 'Final',
  'voiceConsent · ready': 'Your name as you’ll say it',
  'voiceConsent · recording': 'Keep reading. Stop works after a minute.',
  'voiceConsent · checking': 'Checking it’s you saying the consent line… (on this Mac)',
  'voiceConsent · mismatch': 'Taalcut heard',
  'voiceConsent · stored': 'Consent saved on this Mac.',
  'voiceConsent · cloned': 'Your voice is ready.',
  'voiceConsent · failed': 'The recording didn’t work. Nothing was saved.',
  'motionGraphic · half the stalls, placed by time': 'Half the stalls',
  'motionGraphic · shopping list': 'Shopping list',
  'motionGraphic · name card': 'Name card',
  'motionGraphic · ring on the stall': 'Ring on the stall',
  'imageTakes · one': 'In your video',
  'imageTakes · four, slot still a gap': '4 takes',
  'imageTakes · two': 'Images for slot 4',
};

const figure = (page: Page, name: string) => page.locator(`figure[data-fixture="${name}"]`);
const slug = (name: string) => name.replace(/[^A-Za-z0-9]+/g, '-').replace(/-$/, '');

async function arranged(page: Page): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ onboarding: 'done', media: { arranged: true } }),
  });
}

async function openKit(page: Page, theme: 'light' | 'dark', locale: 'en' | 'en-XA' = 'en'): Promise<void> {
  await arranged(page);
  await preferences(page, { theme, locale });
  await open(page, KIT);
  await expect(page.locator('[data-slot=phase3-cards-gallery]')).toBeVisible();
}

/** Axe on the media cards only (e2e/axe.ts's rule). */
async function expectCardsAccessible(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  let axe = axeFor(page);
  for (const name of NAMES) axe = axe.include(`figure[data-fixture="${name}"]`);
  await expectAccessible(page, testInfo, label, axe);
}

/** inspect.ts's userFacingText, inside one card. */
function textIn(card: Locator): Promise<Finding[]> {
  return card.evaluate((root) => {
    const found: { text: string; where: string }[] = [];
    const skip = (el: Element) =>
      el.closest('[translate="no"], time, [data-user-content], figcaption') !== null ||
      !el.checkVisibility({ visibilityProperty: true, opacityProperty: false });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      const el = walker.currentNode.parentElement;
      if (text && el && !skip(el)) found.push({ text, where: el.tagName.toLowerCase() });
    }
    for (const el of root.querySelectorAll('[aria-label], [placeholder], [title], [alt]'))
      for (const name of ['aria-label', 'placeholder', 'title', 'alt']) {
        const value = el.getAttribute(name)?.trim();
        if (value && !skip(el)) found.push({ text: value, where: `${el.tagName.toLowerCase()} @${name}` });
      }
    return found;
  });
}

/** inspect.ts's clippedText, inside one card: wider than its box, or taller than a box that clips. */
function clippedIn(card: Locator): Promise<string[]> {
  return card.evaluate((root) =>
    [root, ...root.querySelectorAll('*')].flatMap((el) => {
      if (!(el instanceof HTMLElement) || el.closest('[data-scroll-x]')) return [];
      const style = getComputedStyle(el);
      if (['inline', 'contents', 'none'].includes(style.display)) return [];
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return [];
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      const wide = el.scrollWidth - el.clientWidth > 1;
      const tall = clipsY && el.scrollHeight - el.clientHeight > 1;
      const what = `${el.tagName.toLowerCase()}[${el.getAttribute('data-slot') ?? ''}] “${(el.textContent ?? '').trim().slice(0, 40)}”`;
      return wide ? [`${what} too wide`] : tall ? [`${what} clipped`] : [];
    }),
  );
}

for (const theme of ['light', 'dark'] as const) {
  test(`every media card state is a real card with its words, axe clean (${theme})`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const problems = await watchProblems(page);
    await openKit(page, theme);
    mkdirSync(SCREENS, { recursive: true });
    for (const name of NAMES) {
      const card = figure(page, name);
      const [type = ''] = name.split(' · ');
      await card.scrollIntoViewIfNeeded();
      await expect(card.locator('[data-pending]')).toHaveCount(0);
      await expect(card.locator(`[data-card-type=${type}]`)).toHaveCount(1);
      await expect(card.getByText(SHOWS[name] ?? '').first()).toBeVisible();
      await card.screenshot({ path: `${SCREENS}${slug(name)}-${theme}.png`, animations: 'disabled' });
    }
    // Decision cards ask in a frame (consent, takes); the others are step panels.
    await expect(
      figure(page, 'voiceConsent · ready').locator('article[data-card-type=voiceConsent]'),
    ).toHaveCount(1);
    await expect(figure(page, 'imageTakes · one').locator('article[data-card-type=imageTakes]')).toHaveCount(
      1,
    );
    // What a model or a person wrote is shown as written.
    await expect(figure(page, 'imageTakes · two').locator('[translate=no]').first()).toBeVisible();
    await expect(
      figure(page, 'voiceConsent · mismatch').getByText('I am Mira and I agree to'),
    ).toHaveAttribute('translate', 'no');
    await expectCardsAccessible(page, testInfo, `Media cards (${theme})`);

    // The open questions: the upload before Create my voice, the withdraw confirmation.
    const stored = figure(page, 'voiceConsent · stored');
    await stored.getByRole('button', { name: 'Create my voice' }).click();
    await expect(stored.getByText('Send your recording off this Mac?')).toBeVisible();
    await expect(stored.getByRole('button', { name: 'Send and create my voice' })).toBeDisabled();
    const cloned = figure(page, 'voiceConsent · cloned');
    await cloned.getByRole('button', { name: 'Withdraw consent' }).click();
    await expect(cloned.getByText(/You can’t undo it\./)).toBeVisible();
    await stored.screenshot({
      path: `${SCREENS}voiceConsent-stored-asking-${theme}.png`,
      animations: 'disabled',
    });
    await cloned.screenshot({
      path: `${SCREENS}voiceConsent-cloned-withdrawing-${theme}.png`,
      animations: 'disabled',
    });
    await expectCardsAccessible(page, testInfo, `Media cards, questions open (${theme})`);
    await stored.getByRole('button', { name: 'Not now' }).click();
    await cloned.getByRole('button', { name: 'Keep my voice' }).click();
    await expect(cloned.getByRole('button', { name: 'Withdraw consent' })).toBeVisible();
    expect(problems).toEqual([]);
  });
}

test('ducking and its margin by keyboard, through music.setDucking on the fake', async ({ page }) => {
  const problems = await watchProblems(page);
  await openKit(page, 'light');
  const card = figure(page, 'voiceover · draft');
  await card.scrollIntoViewIfNeeded();
  const toggle = card.getByRole('switch', { name: 'Lower the music while the voice speaks' });
  const margin = card.locator('[data-slot=margin]');
  await expect(margin).toHaveText('8 LU');
  await card.getByRole('button', { name: 'Remove voiceover' }).focus();
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  expect(await toggle.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(card.getByRole('button', { name: 'Smaller margin' })).toBeDisabled();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Tab');
  const smaller = card.getByRole('button', { name: 'Smaller margin' });
  await expect(smaller).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(margin).toHaveText('7 LU');
  await page.keyboard.press('Tab');
  await expect(card.getByRole('button', { name: 'Bigger margin' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(margin).toHaveText('8 LU');
  await page.keyboard.press('Enter');
  await expect(margin).toHaveText('9 LU');
  expect(problems).toEqual([]);
});

test('Remove voiceover takes it off the video on the fake as one undo step in its project', async ({
  page,
}) => {
  const problems = await watchProblems(page);
  await openKit(page, 'light');
  const card = figure(page, 'voiceover · final, no music');
  await card.scrollIntoViewIfNeeded();
  // No music under this one: nothing to duck.
  await expect(card.getByRole('switch')).toHaveCount(0);
  await card.getByRole('button', { name: 'Remove voiceover' }).click();
  await expect(card.getByText('Voiceover removed from this video.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(card.getByText('Line 1 · slot 1')).toHaveCount(0);
  // The project's history, which the card's Undo names (the kit's app undo is app-wide until it takes the
  // project: "Needs from the lead"); the card follows the timeline back.
  const undone = await fakeCall(page, 'bus.undo', [PROJECT, { source: 'ui', actor: 'user' }]);
  expect(undone).toMatchObject({ ok: true, value: { name: 'voice.removeVoiceover' } });
  await expect(card.getByText('Line 1 · slot 1')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Remove voiceover' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('in the pseudo-locale every media card is translated and fits a 360 px column', async ({ page }) => {
  test.setTimeout(120_000);
  // Tall enough that a card's picture isn't under the window bar.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await openKit(page, 'light', 'en-XA');
  // The chat column's narrowest. Through the CSSOM: the CSP (style-src 'self') refuses a <style> tag.
  await page.evaluate(() => {
    for (const figure of document.querySelectorAll<HTMLElement>('figure[data-fixture]')) {
      figure.style.setProperty('width', '360px');
      figure.style.setProperty('max-width', '360px');
    }
  });
  const phrases = englishPhrases();
  for (const name of NAMES) {
    const card = figure(page, name);
    await card.scrollIntoViewIfNeeded();
    const text = await textIn(card);
    expect(englishShowing(text, phrases), `${name}: English source strings`).toEqual([]);
    expect(untranslated(text), `${name}: strings that skipped the catalogue`).toEqual([]);
    expect(await clippedIn(card), `${name}: text that does not fit`).toEqual([]);
  }
  for (const name of [
    'voiceover · draft',
    'voiceConsent · ready',
    'motionGraphic · ring on the stall',
    'imageTakes · four, slot still a gap',
  ])
    await figure(page, name).screenshot({
      path: `${SCREENS}${slug(name)}-light-en-XA-360.png`,
      animations: 'disabled',
    });
});
