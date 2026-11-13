// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-V11 "Done when" (the renderer's part): recipes put their prompt in the composer, unsent, from the keyboard
// and the pointer; up to three chips sit under an empty state's action; only the recipes whose needs are met show,
// in each language's set (each language's own captions recipes there only); axe-clean in light and dark, and nothing
// English in the pseudo-locale. Against the fakes: a new chat, Golden hour market (a cut) and Product teaser (no
// cut yet). Each recipe's run on the sample library is the desktop recipes.e2e.ts's.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { showDetailedTimeline } from './editor-navigation';
import { englishPhrases, englishShowing, untranslated, type Finding } from './inspect.ts';
import { PROJECT } from './routes.ts';
import { open, preferences } from './support.ts';
import { expectAccessible, fakes, fakeState, shoot } from './ui2b-support.ts';

/** Product teaser: a project with no cut yet (backend/fake/make/ids.ts). */
const TEASER = '01K7C5M6Q8M000000000000004';
const CHAT = { name: 'chat', path: '/chat' };
const EDITOR = { name: 'project-timeline', path: `/projects/${PROJECT}/timeline` };
const UNCUT = { name: 'project-timeline-empty', path: `/projects/${TEASER}/timeline` };

const NEW_CHAT_IDS = ['cut.newReel', 'captions.newReel', 'export.newHooks'];
/** Each language's own recipes (its captions), shown in that language only. */
const OWN: Readonly<Record<string, readonly string[]>> = {
  hi: ['captions.hindi', 'captions.hinglish'],
  es: ['captions.spanish'],
  'pt-BR': ['captions.portuguese'],
};
const LANGUAGE_ONLY = Object.values(OWN).flat();

const dock = (page: Page) => page.locator('[data-slot=editor-dock]');
const menu = (page: Page) => page.locator('[data-slot=recipe-menu]');
const chips = (scope: Page | Locator) => scope.locator('[data-slot=recipe-chips]');
const shown = (scope: Locator) =>
  scope.locator('[data-recipe]').evaluateAll((els) => els.map((el) => el.getAttribute('data-recipe')));
const focusedRecipe = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('data-recipe'));

async function recorded(page: Page): Promise<unknown[]> {
  return (await fakeState<unknown[] | null>(page, 'onboarding.recorded')) ?? [];
}

/**
 * The pseudo-locale on the recipes' own words: the button, the menu and the chips are accented (so they went through
 * the catalogue) and fit. The rest of each page is pseudo-locale.spec.ts's.
 */
async function expectRecipesPseudoClean(page: Page, label: string) {
  const { found, clipped } = await page.evaluate(() => {
    const scopes = document.querySelectorAll(
      '[data-slot=recipes-button], [data-slot=recipe-menu], [data-slot=recipe-chips]',
    );
    const found: { text: string; where: string }[] = [];
    const clipped: { text: string; where: string }[] = [];
    for (const scope of scopes) {
      const where = scope.getAttribute('data-slot') ?? '';
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent?.trim();
        if (text) found.push({ text, where });
      }
      for (const el of [scope, ...scope.querySelectorAll('*')]) {
        const value = el.getAttribute('aria-label');
        if (value) found.push({ text: value, where: `${where} @aria-label` });
        if (el instanceof HTMLElement && el.scrollWidth - el.clientWidth > 1)
          clipped.push({ text: (el.textContent ?? '').trim(), where });
      }
    }
    return { found, clipped };
  });
  expect(found.length, `${label}: recipe words on screen`).toBeGreaterThan(0);
  const words: Finding[] = found;
  expect(englishShowing(words, englishPhrases()), `${label}: English source strings`).toEqual([]);
  expect(untranslated(words), `${label}: strings that skipped the catalogue`).toEqual([]);
  expect(clipped, `${label}: text that does not fit`).toEqual([]);
}

/** The editor's chat with the third clip picked (⌘⇧A adds it), in any language. */
async function openDockChat(page: Page) {
  await open(page, EDITOR);
  await showDetailedTimeline(page);
  const third = page.locator('[data-slot=timeline-clip]').nth(2);
  await third.click();
  await expect(third).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ControlOrMeta+Shift+a');
  await expect(dock(page).locator('[data-slot=composer] [data-slot=selection-chip]')).toBeVisible();
}

test.describe('recipes (P3-V11)', () => {
  test.beforeEach(async ({ page }) => {
    await fakes(page, { telemetry: true, speed: 0, latencyMs: 0 });
  });

  test('a new chat: three chips under the choices, the menu by keyboard, a pick fills the box unsent', async ({
    page,
  }) => {
    await preferences(page, { locale: 'en', theme: 'light' });
    await open(page, CHAT);
    const group = page.getByRole('group', { name: 'Recipes' });
    await expect(group.getByRole('button')).toHaveText([
      'Make a 15-second reel',
      'A reel with captions',
      'Try three hooks',
    ]);
    expect(await shown(chips(page))).toEqual(NEW_CHAT_IDS);

    const button = page.getByRole('button', { name: 'Recipes' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Recipes' })).toBeVisible();
    // A heading per task; only what needs nothing open.
    expect(await shown(menu(page))).toEqual(NEW_CHAT_IDS);
    await expect(menu(page).getByRole('group')).toHaveCount(3);
    await expect.poll(() => focusedRecipe(page)).toBe('cut.newReel');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedRecipe(page)).toBe('captions.newReel');
    await page.keyboard.press('End');
    await expect.poll(() => focusedRecipe(page)).toBe('export.newHooks');
    await page.keyboard.press('Home');
    await expect.poll(() => focusedRecipe(page)).toBe('cut.newReel');
    await page.keyboard.press('a');
    await expect.poll(() => focusedRecipe(page)).toBe('captions.newReel');
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(button).toBeFocused();

    const box = page.getByRole('textbox', { name: 'Message Taalcut' });
    await box.fill('Something I was typing');
    await button.focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedRecipe(page)).toBe('cut.newReel');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedRecipe(page)).toBe('captions.newReel');
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveCount(0);
    await expect(box).toHaveValue(
      'Make a short reel from my newest clips, with captions timed to what’s said.',
    );
    await expect(box).toBeFocused();
    // Unsent: still the new chat, nothing in a transcript.
    await expect(page).toHaveURL(/\/chat\/?$/);
    await expect.poll(() => recorded(page)).toContainEqual({ name: 'recipe.used', category: 'captions' });

    // A chip, by pointer: the same path.
    await group.getByRole('button', { name: 'Try three hooks' }).click();
    await expect(box).toHaveValue(
      'Make a short video from my newest clips in three versions, each with a different hook, so I can compare them.',
    );
    await expect(box).toBeFocused();
    await expect(page).toHaveURL(/\/chat\/?$/);
    await expect.poll(() => recorded(page)).toContainEqual({ name: 'recipe.used', category: 'export' });
  });

  test('the editor’s chat: every task for a cut, a callout for a picked clip, and the chip stays', async ({
    page,
  }) => {
    await preferences(page, { locale: 'en', theme: 'light' });
    await openDockChat(page);
    const tray = dock(page).locator('[data-slot=composer] [data-slot=selection-chip][data-kind=clip]');
    await expect(tray).toContainText('Clip 3');

    await dock(page).getByRole('button', { name: 'Recipes' }).click();
    await expect(menu(page).getByRole('group')).toHaveText([
      /^Cut/,
      /^Captions/,
      /^Music/,
      /^Graphics/,
      /^Look/,
      /^Reframe/,
      /^Export/,
    ]);
    const ids = await shown(menu(page));
    expect(ids).toEqual(expect.arrayContaining(['cut.tighten', 'graphics.callout', 'export.finalCut']));
    for (const id of LANGUAGE_ONLY) expect(ids).not.toContain(id);
    await menu(page).getByRole('menuitem', { name: 'Add a callout here' }).click();
    const box = dock(page).getByRole('textbox', { name: 'Message Taalcut' });
    await expect(box).toHaveValue('Add a callout on what I picked that points out what matters in it.');
    await expect(box).toBeFocused();
    await expect(tray).toContainText('Clip 3');
    await expect(dock(page).locator('article')).toHaveCount(0);
    await expect.poll(() => recorded(page)).toContainEqual({ name: 'recipe.used', category: 'graphics' });
  });

  test('a project with no cut: chips under its action fill the project’s chat', async ({ page }) => {
    await preferences(page, { locale: 'en', theme: 'light' });
    await open(page, UNCUT);
    await expect(page.getByText('Nothing on the timeline yet')).toBeVisible();
    expect(await shown(chips(page))).toEqual(NEW_CHAT_IDS);
    await chips(page).getByRole('button', { name: 'Make a 15-second reel' }).click();
    const box = dock(page).getByRole('textbox', { name: 'Message Taalcut' });
    await expect(box).toHaveValue('Make a 15-second reel from my newest clips, cut on the beat.');
    await expect(box).toBeFocused();
    // Nothing cut yet: the dock's menu has the starters only.
    await dock(page).getByRole('button', { name: 'Recipes' }).click();
    expect(await shown(menu(page))).toEqual(NEW_CHAT_IDS);
  });

  for (const locale of ['en', 'hi', 'es', 'pt-BR', 'en-XA'] as const) {
    test(`the ${locale} set`, async ({ page }) => {
      await preferences(page, { locale, theme: 'light' });
      await openDockChat(page);
      await dock(page).locator('[data-slot=recipes-button]').click();
      await expect(menu(page)).toBeVisible();
      const ids = await shown(menu(page));
      expect(ids).toEqual(
        expect.arrayContaining(['cut.tighten', 'graphics.callout', 'export.finalCut', ...NEW_CHAT_IDS]),
      );
      const mine = OWN[locale] ?? [];
      for (const id of LANGUAGE_ONLY) expect(ids.includes(id), id).toBe(mine.includes(id));
      // Every recipe there is: the shared set, and the language's own.
      expect(ids).toHaveLength(21 + mine.length);
      if (locale === 'en-XA') {
        await expectRecipesPseudoClean(page, 'the editor’s recipe menu');
        await shoot(page, 'recipes-editor-menu-en-XA');
        await page.keyboard.press('Escape');
        await open(page, CHAT);
        await expect(chips(page).getByRole('button')).toHaveCount(3);
        await expectRecipesPseudoClean(page, 'a new chat’s recipes');
        await page.locator('[data-slot=recipes-button]').click();
        await expectRecipesPseudoClean(page, 'a new chat’s recipe menu');
        await shoot(page, 'recipes-chat-menu-en-XA');
      }
    });
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`axe-clean in ${theme}: chips, the menu, an uncut project`, async ({ page }, testInfo) => {
      await preferences(page, { locale: 'en', theme });
      await open(page, CHAT);
      await expectAccessible(page, testInfo, `new chat recipes, ${theme}`);
      await page.getByRole('button', { name: 'Recipes' }).click();
      await expect(menu(page)).toBeVisible();
      await expectAccessible(page, testInfo, `recipe menu, ${theme}`);
      await shoot(page, `recipes-chat-menu-${theme}`);
      await open(page, UNCUT);
      await expect(chips(page)).toBeVisible();
      await expectAccessible(page, testInfo, `uncut project recipes, ${theme}`);
      await shoot(page, `recipes-timeline-empty-${theme}`);
      await openDockChat(page);
      await dock(page).locator('[data-slot=recipes-button]').click();
      await expect(menu(page)).toBeVisible();
      await expectAccessible(page, testInfo, `editor recipe menu, ${theme}`);
      await shoot(page, `recipes-editor-menu-${theme}`);
    });
  }
});
