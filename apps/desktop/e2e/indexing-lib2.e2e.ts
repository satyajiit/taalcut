// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB2: real selection, durable review and a verified managed copy. No model downloads or Photos access. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { importItemOutcomeSchema, importSessionSchema, LOCAL_ONLY_SETTING, unwrap } from '@taalcut/core';
import { createLibraryPorts, openDatabase, ORIGINALS_ROOT_SETTING } from '@taalcut/library';
import { libraryPath } from '../src/shared/library-path';
import { chooseFolder, openIndexingApp, type IndexingApp } from './indexing-app';
import { libraryRows } from './library-rows';
import { readNetworkLogs } from './local-only-support';

// A generated, transparent 1 × 1 PNG: no external fixture, encoder or model is needed for original preservation.
const ORIGINAL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64',
);
// The unselected red pixel differs in content, so substituting the wrong file cannot pass byte verification.
const UNSELECTED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);
let root = '';
let running: IndexingApp | undefined;

test.afterAll(async () => {
  await running?.app.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

async function prepareLibrary(userData: string, destination: string): Promise<void> {
  const db = unwrap(openDatabase({ path: libraryPath(userData) }));
  try {
    const settings = createLibraryPorts(db).settings;
    unwrap(await settings.set(ORIGINALS_ROOT_SETTING, destination));
    unwrap(await settings.set(LOCAL_ONLY_SETTING, true));
  } finally {
    db.close();
  }
}

/** The sole substituted boundary is the native picker response, with a counter for reload side effects. */
async function countPicker(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    const picker = Object.assign(
      async () => {
        picker.calls += 1;
        return { canceled: false, filePaths: [path] };
      },
      { calls: 0 },
    );
    dialog.showOpenDialog = picker as typeof dialog.showOpenDialog;
  }, folder);
}

const pickerCalls = (app: ElectronApplication) =>
  app.evaluate(
    ({ dialog }) => (dialog.showOpenDialog as typeof dialog.showOpenDialog & { calls: number }).calls,
  );

function sessions(userData: string) {
  return (libraryRows(userData, 'SELECT body FROM import_sessions') as { body: string }[]).map((row) =>
    importSessionSchema.parse(JSON.parse(row.body)),
  );
}

const starts = (userData: string) =>
  libraryRows(userData, "SELECT id FROM commands WHERE name = 'imports.start'").length;

test('selected originals copy once and the draft and receipt survive reload', async () => {
  test.setTimeout(120_000);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-lib2-e2e-')));
  const userData = join(root, 'userData');
  const source = join(root, 'footage');
  const destination = join(root, 'originals');
  const network = join(root, 'network');
  mkdirSync(source, { recursive: true });
  mkdirSync(destination);
  writeFileSync(join(source, 'selected.png'), ORIGINAL);
  writeFileSync(join(source, 'leave-here.png'), UNSELECTED);
  await prepareLibrary(userData, destination);
  running = await openIndexingApp(userData, source, { TAALCUT_TEST_NETWORK_LOG: network });
  const { app, page } = running;
  await countPicker(app, source);

  await chooseFolder(page);
  const selected = page.getByRole('option', { name: /^selected\.png/ });
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(selected).toHaveAttribute('aria-selected', 'false');
  await expect(selected).toHaveAttribute('aria-disabled', 'false');
  await selected.click();
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('option', { name: /^leave-here\.png/ })).toHaveAttribute(
    'aria-selected',
    'false',
  );
  await page.getByRole('button', { name: 'Review import', exact: true }).click();
  const reviewUrl = page.url();
  await expect(page.getByRole('radio', { name: 'Copy into Taalcut', exact: false })).toBeChecked();
  await page.reload();
  await expect(page).toHaveURL(reviewUrl);
  await expect(page.getByRole('button', { name: 'Import footage', exact: true })).toBeEnabled();
  expect(await pickerCalls(app)).toBe(1);
  expect(sessions(userData)).toEqual([]);
  expect(starts(userData)).toBe(0);

  await page.goBack();
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await page.goForward();
  await expect(page).toHaveURL(reviewUrl);
  await page.getByRole('button', { name: 'Import footage', exact: true }).click();
  await expect(page).toHaveURL(/\/library\/imports\/[0-9A-HJKMNP-TV-Z]{26}$/);
  const receiptUrl = page.url();
  await expect(page.getByRole('heading', { name: 'Completed', exact: true })).toBeVisible();
  await expect.poll(() => sessions(userData)[0]?.status).toBe('completed');
  const receipt = sessions(userData);
  expect(receipt).toHaveLength(1);
  expect(receipt[0]?.progress).toMatchObject({ totalItems: 1, completedItems: 1, failedItems: 0 });
  expect(receipt[0]?.safeToDisconnect).toBe(true);
  const outcomes = (libraryRows(userData, 'SELECT body FROM import_session_items') as { body: string }[]).map(
    (row) => importItemOutcomeSchema.parse(JSON.parse(row.body)),
  );
  expect(outcomes).toEqual([expect.objectContaining({ name: 'selected.png', state: 'imported' })]);

  const copies = libraryRows(
    userData,
    "SELECT absolute_path_cached AS path FROM asset_locations WHERE storage = 'managed'",
  ) as { path: string }[];
  expect(copies).toHaveLength(1);
  expect(copies[0]!.path.startsWith(`${destination}/`)).toBe(true);
  expect(readFileSync(copies[0]!.path)).toEqual(ORIGINAL);
  expect(readFileSync(join(source, 'selected.png'))).toEqual(ORIGINAL);
  expect(readFileSync(join(source, 'leave-here.png'))).toEqual(UNSELECTED);

  await page.reload();
  await expect(page).toHaveURL(receiptUrl);
  await expect(page.getByRole('heading', { name: 'Completed', exact: true })).toBeVisible();
  await expect(page.getByText('selected.png', { exact: true })).toBeVisible();
  expect(starts(userData)).toBe(1);
  expect(sessions(userData)).toHaveLength(1);
  expect(await pickerCalls(app)).toBe(1);
  await page.screenshot({ path: test.info().outputPath('lib2-managed-copy-receipt.png') });
  const requests = readNetworkLogs(network);
  expect(requests.installed).toContain('main');
  expect(requests.attempts.filter((attempt) => !attempt.allowed)).toEqual([]);
});
