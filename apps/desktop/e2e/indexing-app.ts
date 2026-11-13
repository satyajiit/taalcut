// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real app as the indexing e2e drives it: the test build with the real
 * renderer, started on a userData whose models were installed from local
 * files, with main's open panel answering with the test's footage folder.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, StartupTimeline } from './gate-support';

export interface IndexingApp {
  readonly app: ElectronApplication;
  readonly page: Page;
}

/** main's open panel answers with `folder`, as if the user had picked it. */
export async function answerFolderPanel(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog;
  }, folder);
}

/**
 * `afterQuit`: the app was quit while jobs ran, so it may open with its recovery prompt ("Taalcut is back"),
 * which must say the background jobs continue on their own; the test answers it as a person would.
 */
export async function openIndexingApp(
  userData: string,
  folder: string,
  env: Readonly<Record<string, string>> = {},
  options: { readonly afterQuit?: boolean } = {},
): Promise<IndexingApp> {
  const start = new StartupTimeline();
  const app = await start.step('app launch', 45_000, () => launchApp(userData, env));
  start.listen(app);
  const page = await start.step('first window', 30_000, () => app.firstWindow());
  const ready = page.getByRole('link', { name: 'New chat' });
  const recovery = page.getByRole('dialog', { name: 'Taalcut is back' });
  try {
    await start.step('main connection ready', 30_000, () =>
      (options.afterQuit ? ready.or(recovery) : ready).first().waitFor(),
    );
    if (options.afterQuit && (await recovery.isVisible())) {
      // One job or several: "…will continue on its own" or "…on their own".
      await expect(recovery).toContainText(/will continue on (its|their) own/);
      await recovery.getByRole('button', { name: 'Got it' }).click();
      await ready.waitFor({ timeout: 10_000 });
    }
  } catch (error) {
    // What the window shows instead (a prompt, an error page, nothing), for the failure's message.
    const shown = await page
      .locator('body')
      .innerText({ timeout: 2_000 })
      .catch(() => '(unreadable)');
    await page.screenshot({ path: test.info().outputPath('start-up-stall.png') }).catch(() => undefined);
    throw new Error(`${(error as Error).message}\nThe window shows: ${shown.slice(0, 600)}`, {
      cause: error,
    });
  }
  await answerFolderPanel(app, folder);
  return { app, page };
}

/**
 * Opens the Library from wherever the window is. Indexing takes minutes and the window is a real one, so
 * input from outside the test (a person or another agent clicking it) can leave it on Settings, the Agent or
 * a dialog (IX-B5): close any dialog, leave Settings by its "Back to app" link, then pick Library.
 */
export async function showLibrary(page: Page): Promise<void> {
  const library = page.locator('#app-sidebar').getByRole('link', { name: 'Library', exact: true });
  if (await page.getByRole('dialog').first().isVisible()) await page.keyboard.press('Escape');
  if (!(await library.isVisible())) await page.getByRole('link', { name: 'Back to app' }).click();
  await library.click();
  await expect(page).toHaveURL(/\/library(?:[/?#]|$)/);
}

/** Opens the shared folder journey; the picker still runs only after the explicit Choose folder action. */
export async function chooseFolder(page: Page, watch = false): Promise<void> {
  await showLibrary(page);
  await page.getByRole('banner').getByRole('link', { name: 'Import', exact: true }).click();
  await page.locator('a[href="/library/import/folder"]').click();
  if (watch) await page.getByRole('checkbox', { name: 'Watch this folder for new footage' }).check();
  await page.getByRole('button', { name: 'Choose folder…', exact: true }).click();
  await expect(page).toHaveURL(watch ? /\/review$/ : /\/choose$/);
}

/** Preserves the indexing benchmarks' watched, reference-in-place import through LIB2's explicit review. */
export async function addFolder(page: Page): Promise<void> {
  await chooseFolder(page, true);
  await expect(page.getByRole('radio', { name: 'Keep in place', exact: false })).toBeChecked();
  await page.getByRole('button', { name: 'Start watching', exact: true }).click();
  await expect(page).toHaveURL(/\/library\/imports\/[0-9A-HJKMNP-TV-Z]{26}$/);
}
