// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-V15, round P3-3 "Done when": a message's words that point at a place ("clip 2", "at 0:04") show as chips
// above it while its run is live, from `agent.runStarted.pointers`; words the agent couldn't place say "Not
// found" with the words as written. Against the Make fakes: Golden hour market's editor and its docked chat.
import { expect, test, type Page } from '@playwright/test';
import { PROJECT } from './routes.ts';
import { fakeChat, open, preferences, watchProblems } from './support.ts';
import { expectAccessible, shoot } from './ui2b-support.ts';

const EDITOR = { name: 'project-timeline', path: `/projects/${PROJECT}/timeline` };
const dock = (page: Page) => page.locator('[data-slot=editor-dock]');
const sent = (page: Page) => dock(page).locator('article [data-slot=pointer-chip]');

async function ask(page: Page, text: string) {
  const box = dock(page).getByRole('textbox', { name: 'Message Taalcut' });
  await box.fill(text);
  await box.press('Enter');
}

test.describe('pointer chips (P3-V15)', () => {
  for (const theme of ['light', 'dark'] as const)
    test(`the dock's message shows what its words point at (${theme})`, async ({ page }, testInfo) => {
      await preferences(page, { locale: 'en', theme });
      await fakeChat(page, { speed: 0, latencyMs: 0 });
      const problems = await watchProblems(page);
      await open(page, EDITOR);
      await ask(page, 'Is clip 2 too long at 0:04? And what about 9:59?');

      await expect(sent(page)).toHaveCount(3);
      await expect(sent(page).nth(0)).toHaveAttribute('data-kind', 'clip');
      await expect(sent(page).nth(0)).toHaveText(/^Clip 2 · \d+:\d{2}$/);
      await expect(sent(page).nth(1)).toHaveText(/^Clip \d+ · 0?0:04$/);
      await expect(sent(page).nth(2)).toHaveAttribute('data-kind', 'unresolved');
      await expect(sent(page).nth(2)).toHaveText('Not found: 9:59');
      // The user's words go untranslated, as written.
      await expect(sent(page).nth(2).locator('[translate=no]')).toHaveText('9:59');

      await expectAccessible(page, testInfo, `pointer chips ${theme}`);
      await shoot(page, `pointer-chips-${theme}`);
      expect(problems).toEqual([]);
    });

  test('a message that names no place has no pointer chips', async ({ page }) => {
    await preferences(page, { locale: 'en', theme: 'light' });
    await fakeChat(page, { speed: 0, latencyMs: 0 });
    await open(page, EDITOR);
    await ask(page, 'Something calmer, please');
    await expect(dock(page).locator('article').first()).toBeVisible();
    await expect(sent(page)).toHaveCount(0);
  });
});
