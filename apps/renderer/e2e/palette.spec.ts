// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P1-H6 "Done when": every registered UI command is reachable from ⌘K and
// the palette is usable from the keyboard alone. No mouse in this file.
import { expect, test, type Page } from '@playwright/test';
import { INTERNAL_COMMANDS } from '../src/features/palette/internal-commands.ts';
import { backend } from './backend-driver.ts';
import { TEMPLATE } from './routes.ts';
import { open, preferences } from './support.ts';

const palette = (page: Page) => page.getByRole('dialog', { name: 'Commands' });
const search = (page: Page) => palette(page).getByRole('combobox', { name: 'Search commands' });
/** ⌘K, then wait for the search box: the palette's chunk may still be on its way, and keys typed before it shows go to the page. */
async function openPalette(page: Page) {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search(page)).toBeFocused();
}
/** The option the combobox points at (aria-activedescendant). */
async function activeOption(page: Page) {
  const id = await search(page).getAttribute('aria-activedescendant');
  return page.locator(`[id="${id}"]`);
}

test.beforeEach(async ({ page }) => {
  await preferences(page, { locale: 'en', theme: 'light' });
  await open(page, { name: 'library', path: '/library' });
});

test('⌘K opens, traps focus, runs with Return and gives focus back on Escape', async ({ page }) => {
  // Put focus somewhere first, so we can see it come back.
  await page.keyboard.press('Tab');
  const before = await page.evaluate(() => document.activeElement?.outerHTML);

  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toBeVisible();
  await expect(search(page)).toBeFocused();

  // Tab stays inside the dialog.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await palette(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await search(page).focus();

  // Arrows move the active option; it is announced through aria-activedescendant.
  const first = await (await activeOption(page)).textContent();
  await page.keyboard.press('ArrowDown');
  expect(await (await activeOption(page)).textContent()).not.toBe(first);
  await page.keyboard.press('ArrowUp');
  expect(await (await activeOption(page)).textContent()).toBe(first);

  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.outerHTML)).toBe(before);

  // Fuzzy search, then Return.
  await openPalette(page);
  await page.keyboard.type('tmplts');
  await expect(await activeOption(page)).toContainText('Templates');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  await expect(page).toHaveURL(/\/templates$/);

  // ⌘K again closes it.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toBeHidden();
});

test('the sidebar’s Commands button opens it too, and gets focus back', async ({ page }) => {
  const button = page.getByRole('button', { name: 'Commands' });
  await expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(search(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
  await expect(button).toBeFocused();
});

test('shows shortcuts, and they work without opening the palette', async ({ page }) => {
  await openPalette(page);
  await page.keyboard.type('templates');
  const option = await activeOption(page);
  await expect(option).toHaveAttribute('aria-keyshortcuts', 'Meta+3');
  await expect(option).toContainText('⌘');
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+3');
  await expect(page).toHaveURL(/\/templates$/);
  await page.keyboard.press('ControlOrMeta+,');
  await expect(page).toHaveURL(/\/settings\/general$/);
});

test('the app menu’s Go items run the same items (ui.action from main)', async ({ page }) => {
  // The palette's chunk, which listens, may still be on its way: send until it lands.
  await expect(async () => {
    await backend.menu(page, 'go.templates');
    await expect(page).toHaveURL(/\/templates$/, { timeout: 500 });
  }).toPass();
  await backend.menu(page, 'go.settings');
  await expect(page).toHaveURL(/\/settings\/general$/);
  // Edit › Undo and Redo: the same items as ⌘Z and ⌘⇧Z.
  expect(await backend.agentDispatch(page, 'settings.setTheme', { preference: 'dark' })).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(async () => {
    await backend.menu(page, 'edit.undo');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light', { timeout: 500 });
  }).toPass();
  // An action this page doesn't know changes nothing.
  await backend.menu(page, 'go.nowhere');
  await expect(page).toHaveURL(/\/settings\/general$/);
});

test('the agent’s hub.openShare opens that template’s Share dialog (ui.action from main)', async ({
  page,
}) => {
  await open(page, { name: 'templates', path: '/templates' });
  expect(await backend.agentDispatch(page, 'hub.openShare', { projectId: null, templateId: TEMPLATE })).toBe(
    true,
  );
  // Sharing is on the template's Details page (UX4 tpl).
  await expect(page).toHaveURL(new RegExp(`/templates/${TEMPLATE}/details$`));
  await expect(page.getByRole('dialog', { name: 'Share to the template hub' })).toBeVisible();
});

test('switches the theme as a command on the bus', async ({ page }) => {
  await openPalette(page);
  await page.keyboard.type('dark theme');
  await expect(await activeOption(page)).toHaveAttribute('data-command', 'settings.setTheme');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await backend.dispatched(page)).toContainEqual({ name: 'settings.setTheme', source: 'ui' });

  // And undo is a command too.
  await openPalette(page);
  // The palette reloads the bus's history; wait until Undo knows what it undoes before searching,
  // or the search settles on another match ("Reset a job…" has the keyword "undo").
  await expect(palette(page).locator('[role=option][data-command="edit.undo"]')).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.type('undo');
  await expect
    .poll(async () => (await activeOption(page)).textContent())
    .toContain('Undo “Change the theme”');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // ⌘⇧Z and ⌘Z, bound from the shortcuts the bus lists, without opening ⌘K. Redo is live once the
  // undo's command.changed has refreshed the history; pressing again with nothing left does nothing.
  const theme = page.locator('html');
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(theme).toHaveAttribute('data-theme', 'dark', { timeout: 300 });
  }).toPass();
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+z');
    await expect(theme).toHaveAttribute('data-theme', 'light', { timeout: 300 });
  }).toPass();
});

test('a clip found for what is typed says why when its name doesn’t: “goa” in what is said or on screen', async ({
  page,
}) => {
  await openPalette(page);
  await page.keyboard.type('goa');
  const clips = palette(page).getByRole('group', { name: 'Clips' }).getByRole('option');
  await expect(clips.first()).toBeVisible();
  for (const clip of await clips.all()) {
    const why = clip.locator('[data-slot=palette-why]');
    const name = await clip
      .locator('span')
      .first()
      .evaluate((el) =>
        [...el.childNodes]
          .filter((node) => !(node instanceof HTMLElement && node.dataset.slot === 'palette-why'))
          .map((node) => node.textContent)
          .join('')
          .trim(),
      );
    if (/goa/i.test(name)) continue;
    // Not by its name: the line under it says where Goa is, with the word marked.
    await expect(why, name).toHaveText(/^(Said|On screen|Described) · .*goa/i);
    await expect(why.locator('mark').first(), name).toHaveText(/^goa$/i);
  }
});

test('every command registered on the bus is reachable from ⌘K', async ({ page }) => {
  // Start on a page no command goes to, so a Go item always changes the page.
  const start = { name: 'settings-memory', path: '/settings/memory' };
  await open(page, start);
  // A command that needs a payload is offered only through an item that supplies it (a preset or an opener, see
  // paletteOffer in internal-commands.ts): walk those the palette lists, and every command that needs none.
  await openPalette(page);
  const offered = new Set(
    await palette(page)
      .locator('[role=option][data-command]')
      .evaluateAll((options) => options.map((option) => option.getAttribute('data-command'))),
  );
  await page.keyboard.press('Escape');
  const commands = (await backend.commands(page))
    .filter(({ name, needsPayload }) => !INTERNAL_COMMANDS.has(name) && (!needsPayload || offered.has(name)))
    .map(({ name }) => name);
  expect(commands.length).toBeGreaterThan(0);
  // One walk through ⌘K per command, so the budget grows with the bus: about 0.4 s each alone, 1.5 s allowed
  // under a full suite's load. Each step keeps its own expect timeout, so a stuck command still fails fast.
  test.setTimeout(15_000 + commands.length * 1_500);

  for (const name of commands) {
    await openPalette(page);
    const listed = palette(page).locator(`[role=option][data-command="${name}"]`);
    await expect(listed.first(), `${name} is in the palette`).toBeVisible();
    // Undo and Redo with nothing to undo or redo are there, but greyed out.
    if ((await listed.first().getAttribute('aria-disabled')) === 'true') {
      await page.keyboard.press('Escape');
      continue;
    }
    const options = palette(page).locator(`[role=option][data-command="${name}"]:not([aria-disabled=true])`);
    const title = (await options.first().locator('span').first().textContent())?.trim() ?? '';

    // Reach it by typing its title, then run it with Return.
    const url = page.url();
    const ranBefore = (await backend.dispatched(page)).length;
    // Toggle Sidebar is carried out by the page: it folds the sidebar to its rail, and is undone after.
    const sidebar = name === 'view.sidebar';
    const folded = page.locator('[data-slot=sidebar][data-collapsed]');
    // Send feedback is carried out by the page too: it opens the dialog, closed after.
    const feedback = name === 'help.feedback';
    const dialog = page.locator('[data-slot=feedback-dialog]');
    await page.keyboard.type(title);
    await expect(await activeOption(page), `typing “${title}” finds ${name}`).toHaveAttribute(
      'data-command',
      name,
    );
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    // A Go item navigates and Toggle Sidebar folds the sidebar (the page carries out those UI
    // commands); the rest run on the bus.
    const ran = async () =>
      (await backend.dispatched(page)).slice(ranBefore).some((d) => d.name === name && d.source === 'ui');
    await expect
      .poll(
        async () =>
          (await ran()) ||
          page.url() !== url ||
          (sidebar && (await folded.count()) === 1) ||
          (feedback && (await dialog.isVisible())),
        { message: `${name} ran, or opened the screen where it is done` },
      )
      .toBe(true);
    if (sidebar) await page.getByRole('button', { name: 'Sidebar', expanded: false }).click();
    if (feedback) {
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
    if (page.url() !== url) await open(page, start);
  }
});
