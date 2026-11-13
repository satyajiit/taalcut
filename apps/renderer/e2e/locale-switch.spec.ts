// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-L2 "Done when": switching language changes every route without a restart. On every route in routes.ts the
// language moves through the four app languages and back, as Settings, ⌘K or the agent switches it
// (settings.setLocale on the bus, then locale.changed), and nothing reloads: <html lang> follows each time. In
// each language no English is left where that language has its own words, and back in English none of the
// three languages' words is left. The test build's fifth language, the pseudo-locale, translates every string,
// so it also shows that every string on the route really changes.
// The person's own state survives a switch: a typed composer draft and the scroll position.
import { expect, test, type Page } from '@playwright/test';
import {
  englishPhrases,
  englishShowing,
  localePhrases,
  translatedPhrases,
  userFacingText,
} from './inspect.ts';
import { ROUTES } from './routes.ts';
import { open, preferences } from './support.ts';

type Language = 'en' | 'hi' | 'es' | 'pt-BR';

interface SwitchWindow {
  taalcutFake: {
    bus: {
      dispatch(
        name: string,
        payload: unknown,
        origin: { source: string; actor: string },
      ): Promise<{ ok: boolean }>;
    };
  };
  taalcutPseudoLocale(on: boolean): Promise<void>;
  taalcutNotReloaded?: true;
}

/** settings.setLocale from the person, as Settings › General › Language dispatches it. */
async function switchTo(page: Page, preference: Language): Promise<void> {
  const ok = await page.evaluate(
    async (value) =>
      (
        await (window as unknown as SwitchWindow).taalcutFake.bus.dispatch(
          'settings.setLocale',
          { preference: value },
          { source: 'ui', actor: 'user' },
        )
      ).ok,
    preference,
  );
  expect(ok, `settings.setLocale ${preference}`).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('lang', preference);
}

const pseudo = (page: Page, on: boolean) =>
  page.evaluate((value) => (window as unknown as SwitchWindow).taalcutPseudoLocale(value), on);

const phrases = englishPhrases();
const DRAFTS = ['hi', 'es', 'pt-BR'] as const;
/** English runs each language has its own words for, and each language's own runs. */
const leaked = Object.fromEntries(DRAFTS.map((language) => [language, translatedPhrases(language)]));
const foreign = DRAFTS.flatMap((language) => localePhrases(language));

for (const route of ROUTES) {
  test(`${route.name}: every language, no restart`, async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, route);
    await page.evaluate(() => {
      (window as unknown as SwitchWindow).taalcutNotReloaded = true;
    });

    for (const language of DRAFTS) {
      await switchTo(page, language);
      await expect
        .poll(async () => englishShowing(await userFacingText(page), leaked[language] ?? []), {
          message: `English left after switching to ${language}`,
        })
        .toEqual([]);
    }
    await switchTo(page, 'en');
    await expect
      .poll(async () => englishShowing(await userFacingText(page), foreign), {
        message: 'another language left after switching back to English',
      })
      .toEqual([]);

    await pseudo(page, true);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
    await expect
      .poll(async () => englishShowing(await userFacingText(page), phrases), {
        message: 'English source strings still on screen after the switch',
      })
      .toEqual([]);

    await pseudo(page, false);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect
      .poll(async () => (await userFacingText(page)).filter((found) => found.text.includes('~')), {
        message: 'pseudo-locale strings left after switching back',
      })
      .toEqual([]);

    expect(
      await page.evaluate(() => (window as unknown as SwitchWindow).taalcutNotReloaded),
      'the page never reloaded',
    ).toBe(true);
  });
}

test('a typed draft and the scroll position survive a switch', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, { name: 'library', path: '/library' });
  const scroller = page.locator('[data-slot=scroll-area]').first();
  await scroller.evaluate((el) => el.scrollBy(0, 900));
  // What has to survive is the place in the grid: the clip at the top of the view stays where it is on screen.
  // Not scrollTop itself: words above the grid can wrap differently in another language (the import strip is a
  // line taller in Spanish), and the browser's scroll anchoring then moves scrollTop to hold the view still.
  const firstInView = () =>
    scroller.evaluate((el) => {
      const edge = el.getBoundingClientRect().top;
      const tile = [...el.querySelectorAll('[data-slot=clip-grid] a')].find(
        (each) => each.getBoundingClientRect().top >= edge,
      );
      return tile
        ? { href: tile.getAttribute('href'), top: Math.round(tile.getBoundingClientRect().top) }
        : null;
    });
  const before = await firstInView();
  expect(before, 'a clip at the top of the view').not.toBeNull();
  await switchTo(page, 'es');
  await expect.poll(firstInView).toEqual(before);
  await switchTo(page, 'en');

  await open(page, { name: 'chat', path: '/chat' });
  const composer = page.getByRole('textbox').first();
  await composer.fill('A 30 second reel of my weekend');
  await switchTo(page, 'pt-BR');
  await expect(composer).toHaveValue('A 30 second reel of my weekend');
  await switchTo(page, 'en');
  await expect(composer).toHaveValue('A 30 second reel of my weekend');
});

test('Settings › General › Language switches the app, and says the choice in its own language', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, { name: 'settings-general', path: '/settings/general#language' });
  // Found by its options (the kit's radios, role=radio with their value): its name is in the language it's showing.
  const option = (value: string) => page.locator(`[role=radio][value="${value}"]`);
  const group = page.getByRole('radiogroup').filter({ has: option('hi') });
  await group.locator('[role=radio][value="hi"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(group.locator('[role=radio][value="hi"]')).toHaveAttribute('aria-checked', 'true');
  await expect(group.locator('[lang="hi"]').first()).toBeVisible();
  await group.locator('[role=radio][value="system"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(group.locator('[role=radio][value="system"]')).toHaveAttribute('aria-checked', 'true');
});
