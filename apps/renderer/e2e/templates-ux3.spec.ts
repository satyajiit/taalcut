// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-TPL "Done when": every Templates route and its main states (the library full, searching, a folder with its
// style profile, empty; a template; the hub browsing, offline and a hub template; Saved on Instagram signed out and
// signed in) is axe clean in light and dark, and nothing English or clipped in the pseudo-locale. Screenshots of
// each at 1440×900 and 1280×800 go to `$TAALCUT_TPL_SCREENS/<phase>/` (`TAALCUT_TPL_PHASE`, default `after`), the
// whole page grown to its content, as `<scene>-<theme>-<width>x<height>.png`. Against the fake backend.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expectAccessible } from './axe.ts';
import { ARTIFACTS, FAKE_OPTIONS_KEY, open, preferences } from './support.ts';
import { expectPseudoCleanWithin } from './templates-support.ts';

const GOLDEN = '01K7C5M6Q85000000000000001';
const CAFE = '01K7C5M6Q8H000000000000001';
const SCREENS = `${(
  process.env.TAALCUT_TPL_SCREENS ?? new URL('screenshots/templates-ux3/', ARTIFACTS).pathname
).replace(/\/?$/, '/')}${process.env.TAALCUT_TPL_PHASE ?? 'after'}/`;
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const;

interface Scene {
  readonly name: string;
  readonly path: string;
  /** `taalcut.fake` for the scene, over `{ latencyMs: 0, speed: 0 }`. */
  readonly fake?: Record<string, unknown>;
  /** What to do once the page has loaded, before the checks. */
  readonly then?: (page: Page) => Promise<void>;
}

// The steps find things by their slots, not their words, so each scene runs in the pseudo-locale too.
async function signInToSaved(page: Page) {
  await page.locator('[data-slot=saved-signin] button').click();
  await page.locator('[data-slot=warning-card] [data-action=acknowledge]').click();
  await expect(page.locator('[data-slot=saved-collections]')).toBeVisible();
  await expect(page.locator('[data-slot=style-profile]')).toBeVisible();
}

const SCENES: readonly Scene[] = [
  { name: 'templates', path: '/templates', fake: { templates: 24 } },
  { name: 'templates-few', path: '/templates' },
  { name: 'templates-empty', path: '/templates', fake: { templates: 'empty' } },
  {
    name: 'templates-search',
    path: '/templates?q=morning',
    fake: { templates: 24, templateSearch: 'ready' },
    then: async (page) => {
      await page.locator('[data-slot=templates] [role=combobox]').focus();
      await expect(page.locator('[data-slot=template-search-panel]')).toBeVisible();
    },
  },
  {
    name: 'templates-folder',
    path: '/templates',
    fake: { templates: 200 },
    then: async (page) => {
      // A folder is a page (UX4 tpl): the rail's places are links.
      await page.locator('[data-slot=folder-rail] a', { hasText: 'Travel' }).first().click();
      await expect(page.locator('[data-slot=style-profile]')).toBeVisible();
      await expect(page.locator('[data-written=local]')).toBeVisible();
    },
  },
  // UX4 tpl: New, Start from…'s three views, a template's four pages and Saved's collection and settings.
  { name: 'templates-new', path: '/templates/new' },
  { name: 'start', path: '/templates/start' },
  { name: 'start-formats', path: '/templates/start/formats' },
  { name: 'template', path: `/templates/${GOLDEN}` },
  { name: 'template-slots', path: `/templates/${GOLDEN}/slots` },
  { name: 'template-pacing', path: `/templates/${GOLDEN}/pacing` },
  { name: 'template-details', path: `/templates/${GOLDEN}/details` },
  { name: 'hub', path: '/templates/start/community' },
  { name: 'hub-offline', path: '/templates/start/community', fake: { hub: { state: 'offline' } } },
  { name: 'hub-template', path: `/templates/start/community/${CAFE}` },
  { name: 'saved-signed-out', path: '/templates/saved' },
  { name: 'saved', path: '/templates/saved/col_inspo', then: signInToSaved },
  {
    name: 'saved-settings',
    path: '/templates/saved/settings',
    then: async (page) => {
      await page.locator('[data-slot=saved-signin] button').click();
      await page.locator('[data-slot=warning-card] [data-action=acknowledge]').click();
      await expect(page.locator('[data-slot=saved-settings]')).toBeVisible();
    },
  },
];

async function arrange(page: Page, scene: Scene, theme: 'light' | 'dark', locale: 'en' | 'en-XA' = 'en') {
  await preferences(page, { theme, locale });
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ latencyMs: 0, speed: 0, indexingTickMs: 0, ...scene.fake }),
  });
  await open(page, { name: scene.name, path: scene.path });
  await scene.then?.(page);
}

/** The whole page at each size: the window grows to the app's scroll area, as screenshotWhole does. */
async function shootScene(page: Page, file: string) {
  mkdirSync(SCREENS, { recursive: true });
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const height = await page.evaluate(() => {
      const areas = [...document.querySelectorAll<HTMLElement>('[data-slot=scroll-area]')];
      return Math.max(
        window.innerHeight,
        ...areas.map((el) => el.getBoundingClientRect().top + el.scrollHeight),
      );
    });
    if (height > size.height)
      await page.setViewportSize({ width: size.width, height: Math.min(Math.ceil(height), 4000) });
    await page.screenshot({
      path: `${SCREENS}${file}-${size.width}x${size.height}.png`,
      animations: 'disabled',
    });
  }
  await page.setViewportSize(SIZES[1]);
}

test.describe('the Templates routes in both themes (UX3-TPL)', () => {
  for (const scene of SCENES)
    for (const theme of ['light', 'dark'] as const)
      test(`${scene.name} (${theme}): axe clean, screenshots at 1440 and 1280`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize(SIZES[1]);
        await arrange(page, scene, theme);
        await expectAccessible(page, testInfo, `${scene.name} ${theme}`);
        await shootScene(page, `${scene.name}-${theme}`);
      });
});

test.describe('the Templates routes in the pseudo-locale (UX3-TPL)', () => {
  for (const scene of SCENES)
    test(`${scene.name}: nothing English, nothing clipped`, async ({ page }) => {
      await page.setViewportSize(SIZES[1]);
      await arrange(page, scene, 'light', 'en-XA');
      // The page's own content and its actions in the window bar; the sidebar has the shell's checks.
      await expectPseudoCleanWithin(page, '#main', `${scene.name} en-XA`);
      if ((await page.locator('[data-slot=window-bar-actions] button').count()) > 0)
        await expectPseudoCleanWithin(page, '[data-slot=window-bar-actions]', `${scene.name} en-XA, bar`);
    });
});
