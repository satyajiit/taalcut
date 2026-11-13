// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P2-X3 "Done when" (the window's part): the project list, newest change first, each project's cut on the
// time axis; renaming and archiving are commands with Undo; a project the recovery report names says so
// after a crash; and the timeline's versions restore, undoably. UX1: the area is titled Make, its views
// (Projects, Exports, Archived) lead to each other, rows show their box on hover, focus or in selection
// mode, a project with no video has a real placeholder, and the list loads behind its captured bones.
// Axe, the pseudo-locale and the screenshots visit /projects with every route (routes.ts).
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { fakeChat, open, preferences, watchProblems } from './support.ts';

const PROJECTS = { name: 'projects', path: '/projects' };
const GOLDEN = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA';
const TRIP = '01K7C5M6Q8R9S0T1V2W3X4P001';

const rows = (page: Page) => page.locator('[data-slot=project-row]');
const row = (page: Page, id: string) => page.locator(`[data-slot=project-row][data-project-id="${id}"]`);
const toast = (page: Page) => page.locator('[data-slot=toast]').last();
const views = (page: Page) => page.getByRole('navigation', { name: 'Make' });
const title = (page: Page) => page.locator('[data-slot=window-title]');

test.describe('projects (P2-X3)', () => {
  test.beforeEach(async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakeChat(page, { latencyMs: 30, renderTickMs: 0 });
  });

  test('every project newest first, with its cut, its facts and who picked what', async ({ page }) => {
    const problems = await watchProblems(page);
    await open(page, PROJECTS);
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).first()).toContainText('Golden hour market');
    await expect(row(page, GOLDEN)).toContainText('3 videos');
    await expect(row(page, GOLDEN)).toContainText('1 clip you picked');
    // The cut: one block per clip, the AI's picks and yours told apart (and in words above).
    const cut = row(page, GOLDEN).locator('[data-slot=project-cut] > span');
    await expect(cut).toHaveCount(12);
    await expect(row(page, GOLDEN).locator('[data-chosen-by=you]')).toHaveCount(1);
    // Titled Make, like the area; its views say where you are.
    await expect(title(page)).toHaveText('Make');
    await expect(views(page).getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-slot=view-count]')).toHaveText('4 projects');
    // The Make area is current, and opening a project goes to its timeline.
    await expect(page.getByRole('link', { name: 'Make', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await row(page, GOLDEN).getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/projects/${GOLDEN}/timeline`));
    expect(problems).toEqual([]);
  });

  test('renaming is a command, and Undo in the toast puts the name back', async ({ page }) => {
    await open(page, PROJECTS);
    await row(page, GOLDEN).getByRole('button', { name: 'More for Golden hour market' }).click();
    await page.getByRole('menuitem', { name: 'Rename…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename the project' });
    const field = dialog.getByRole('textbox', { name: 'Name' });
    await expect(field).toHaveValue('Golden hour market');
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await field.fill('Goa market, golden hour');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page, GOLDEN)).toContainText('Goa market, golden hour');
    await expect(toast(page)).toContainText('Renamed to Goa market, golden hour');
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await expect(row(page, GOLDEN)).toContainText('Golden hour market');
    const ran = (await backend.dispatched(page)).filter((d) => d.name.startsWith('project.'));
    expect(ran).toEqual([{ name: 'project.rename', source: 'ui' }]);
  });

  test('archiving moves a project to Archived; Undo brings it back', async ({ page }) => {
    await open(page, PROJECTS);
    await row(page, TRIP).getByRole('button', { name: 'More for Trip to Goa reel' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(row(page, TRIP)).toHaveCount(0);
    await expect(page.locator('[data-slot=view-count]')).toHaveText('3 projects');
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await expect(row(page, TRIP)).toHaveCount(1);

    await views(page).getByRole('link', { name: 'Archived' }).click();
    await expect(page).toHaveURL(/archived=true/);
    await expect(title(page)).toHaveText('MakeArchived');
    await expect(page.getByRole('region', { name: 'Archived projects' })).toBeVisible();
    await expect(views(page).getByRole('link', { name: 'Archived' })).toHaveAttribute('aria-current', 'page');
    await expect(rows(page)).toHaveCount(1);
    await rows(page)
      .first()
      .getByRole('button', { name: /^More for/ })
      .click();
    await page.getByRole('menuitem', { name: 'Bring back' }).click();
    await expect(page.getByRole('heading', { name: 'Nothing archived' })).toBeVisible();
    // The way back is the view, as on every page of Make: no one-off "Back to…" link.
    await expect(page.getByRole('link', { name: /^Back to/ })).toHaveCount(0);
    await views(page).getByRole('link', { name: 'Projects' }).click();
    await expect(rows(page)).toHaveCount(5);
  });

  test('the views lead to Exports and back; the bar reads Make › Exports', async ({ page }) => {
    const problems = await watchProblems(page);
    await open(page, PROJECTS);
    await views(page).getByRole('link', { name: 'Exports' }).click();
    await expect(page).toHaveURL(/\/renders$/);
    await expect(title(page)).toHaveText('MakeExports');
    await expect(views(page).getByRole('link', { name: 'Exports' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-slot=render-row]').first()).toBeVisible();
    await views(page).getByRole('link', { name: 'Projects' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(rows(page)).toHaveCount(4);
    expect(problems).toEqual([]);
  });

  test('a row shows its box on hover and focus; Select shows them all, and Escape lets go', async ({
    page,
  }) => {
    await open(page, PROJECTS);
    const box = (id: string) => row(page, id).locator('[data-slot=list-row-select]');
    await expect(box(GOLDEN)).toHaveCSS('opacity', '0');
    await row(page, GOLDEN).hover();
    await expect(box(GOLDEN)).toHaveCSS('opacity', '1');
    await page.mouse.move(0, 0);
    // Keyboard: the box is the row's first stop, and shows while it has focus.
    await page.getByRole('checkbox', { name: 'Select Trip to Goa reel' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('toolbar', { name: 'Selected projects' })).toContainText(
      '1 project selected',
    );
    await expect(box(GOLDEN)).toHaveCSS('opacity', '1');
    await expect(row(page, TRIP)).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('toolbar', { name: 'Selected projects' })).toHaveCount(0);
    await expect(row(page, TRIP)).not.toHaveAttribute('data-selected', 'true');

    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await expect(page.getByRole('toolbar', { name: 'Selected projects' })).toContainText(
      'Pick the projects to export or restyle.',
    );
    await expect(box(GOLDEN)).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('toolbar', { name: 'Selected projects' })).toHaveCount(0);
  });

  test('the first visit to Make has a tip on the rows; dismissed, it stays away', async ({ page }) => {
    await open(page, PROJECTS);
    const tip = page.locator('[data-slot=kaatu-moment][data-tone=tip]');
    await expect(tip).toContainText('A violet edge is a shot Taalcut picked');
    await tip.getByRole('button', { name: 'Dismiss tip' }).click();
    await expect(tip).toHaveCount(0);
    await page.reload();
    await expect(rows(page).first()).toBeVisible();
    await expect(tip).toHaveCount(0);
  });

  test('a project’s More menu exports it: the editor opens on the export’s first step', async ({ page }) => {
    await open(page, PROJECTS);
    await row(page, GOLDEN).getByRole('button', { name: 'More for Golden hour market' }).click();
    await page.getByRole('menuitem', { name: 'Export…' }).click();
    await expect(page).toHaveURL(/\/timeline\?.*export=true/);
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await expect(dialog.getByRole('heading', { level: 3, name: 'Where it’s going' })).toBeFocused();
  });

  test('a project with no video yet shows a placeholder frame, not a black tile', async ({ page }) => {
    await open(page, PROJECTS);
    const teaser = rows(page).filter({ hasText: 'Product teaser, 15 s' });
    await expect(teaser).toContainText('No video yet');
    await expect(teaser.locator('[data-slot=project-poster-empty]')).toBeVisible();
  });

  test('loading: the rows’ bones and the count’s place, then the rows', async ({ page }) => {
    // The Make reads wait 1.5 s (the fake's libraryLatencyMs), after the beforeEach's options.
    await page.addInitScript(() =>
      window.localStorage.setItem(
        'taalcut.fake',
        JSON.stringify({ latencyMs: 30, renderTickMs: 0, libraryLatencyMs: 1500 }),
      ),
    );
    await page.goto(PROJECTS.path);
    await expect(page.locator('[data-boneyard="make-projects"][aria-busy="true"]')).toBeVisible();
    await expect(page.locator('[data-slot=view-count].tc-bone')).toBeVisible();
    await expect(rows(page)).toHaveCount(4, { timeout: 5_000 });
    await expect(page.locator('[data-slot=view-count]')).toHaveText('4 projects');
  });

  test('after a crash, the projects the recovery report names say their last change is here', async ({
    page,
  }) => {
    await fakeChat(page, { latencyMs: 30, renderTickMs: 0, recovery: 'restored' });
    await open(page, PROJECTS);
    await page
      .getByRole('dialog', { name: 'Taalcut is back' })
      .getByRole('button', { name: 'Got it' })
      .click();
    const recovered = row(page, TRIP).locator('[data-slot=project-recovered]');
    await expect(recovered).toContainText('Recovered after Taalcut closed unexpectedly.');
    await expect(recovered).toContainText('Your last change is here');
    await expect(page.locator('[data-slot=project-recovered]')).toHaveCount(1);
  });

  test('an ordinary launch marks nothing recovered', async ({ page }) => {
    await open(page, PROJECTS);
    await expect(rows(page)).toHaveCount(4);
    await expect(page.locator('[data-slot=project-recovered]')).toHaveCount(0);
  });

  test('nothing made yet: the ghost cut, Kaatu and one way to start', async ({ page }) => {
    await fakeChat(page, { latencyMs: 30, projects: 'empty' });
    await open(page, PROJECTS);
    await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
    await expect(page.locator('[data-slot=ghost-timeline]')).toBeVisible();
    // The page's own Kaatu; the companion at the sidebar's foot is the sidebar's (UX4).
    await expect(page.locator('main [data-slot=mascot]')).toHaveCount(1);
    // One primary on the screen: the empty state's.
    await expect(page.getByRole('link', { name: 'Make a video' })).toHaveCount(1);
  });

  test('a version restores, and ⌘Z puts back what was there', async ({ page }) => {
    await open(page, PROJECTS);
    await row(page, GOLDEN).getByRole('link').first().click();
    await page.getByRole('button', { name: 'Versions' }).click();
    const panel = page.locator('[data-slot=versions-panel]');
    await expect(panel.locator('[data-slot=version-row]').first()).toBeVisible();
    const before = await panel.locator('[data-slot=version-row]').count();
    await panel
      .locator('[data-slot=version-row][data-kind=auto]')
      .last()
      .getByRole('button', { name: /^Restore/ })
      .click();
    await expect(toast(page)).toContainText('Restored version');
    // The restore kept what was there first, as its own version.
    await expect(panel.locator('[data-slot=version-row]')).toHaveCount(before + 1);
    await expect(panel.locator('[data-slot=version-row]').first()).toHaveAttribute(
      'data-kind',
      'before-restore',
    );
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    const ran = (await backend.dispatched(page)).filter((d) => d.name === 'project.restoreVersion');
    expect(ran).toEqual([{ name: 'project.restoreVersion', source: 'ui' }]);
  });

  test('axe finds nothing on the list, its menu and the rename dialog, light and dark', async ({
    page,
  }, testInfo) => {
    // Six axe runs, two themes: slow on a loaded machine.
    test.slow();
    for (const theme of ['light', 'dark'] as const) {
      await preferences(page, { theme, locale: 'en' });
      await open(page, PROJECTS);
      await expectAccessible(page, testInfo, `projects (${theme})`);
      await row(page, GOLDEN).getByRole('button', { name: 'More for Golden hour market' }).click();
      await page.getByRole('menuitem', { name: 'Rename…' }).click();
      await expect(page.getByRole('dialog', { name: 'Rename the project' })).toBeVisible();
      await expectAccessible(page, testInfo, `projects, rename dialog (${theme})`);
      await page.keyboard.press('Escape');
    }
  });

  test('axe finds nothing in selection mode, on Archived and on Exports, light and dark', async ({
    page,
  }, testInfo) => {
    test.slow();
    for (const theme of ['light', 'dark'] as const) {
      await preferences(page, { theme, locale: 'en' });
      await open(page, PROJECTS);
      await page.getByRole('button', { name: 'Select', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Select Golden hour market' }).check();
      await expectAccessible(page, testInfo, `projects, selecting (${theme})`);
      await open(page, { name: 'projects-archived', path: '/projects?archived=true' });
      await expectAccessible(page, testInfo, `projects, archived (${theme})`);
      await open(page, { name: 'renders', path: '/renders' });
      await expectAccessible(page, testInfo, `exports (${theme})`);
    }
  });
});
