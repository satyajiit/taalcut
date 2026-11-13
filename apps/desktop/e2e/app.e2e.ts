// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Launch test for the unpackaged build (out/), driven by Playwright for
 * Electron. Reads back what P1-B1's "Done when" asks for: web preferences,
 * the CSP header on app:// documents, no Node in the renderer; plus the
 * theme's no-flash launch, navigation and permission lockdown, and P1-B2's
 * "killed utility process restarts within 2 s".
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mainI18n } from '../src/main/i18n/i18n';
import { APP_CSP } from '../src/main/security/csp';
import { launchElectron } from './launch';
import { savedTheme, seedTheme } from './library-seed';
import { bridgeKeys, cspBlocks, fetchFromPage, nodeGlobals, preloadGlobals } from './renderer-probes';
const DARK_CANVAS = '#181715';
const LIGHT_CANVAS = '#faf6f1';

/** Present on WebContents at runtime but missing from Electron's typings. */
interface WithLastWebPreferences {
  getLastWebPreferences(): Record<string, unknown> | null;
}

let app: ElectronApplication;
let page: Page;
let userData: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'taalcut-e2e-'));
  // Saved preference "dark": the window must open dark, with no light first frame.
  await seedTheme(userData, 'dark');
  // Always test the app:// build, even if a dev server URL is exported in the shell.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TAALCUT_RENDERER_URL',
    ),
  );
  app = await launchElectron(userData, {
    env,
    // Playwright emulates a light colour scheme by default; the theme test needs the real one.
    colorScheme: null,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

test('loads the renderer from app://taalcut/', async () => {
  expect(page.url()).toBe('app://taalcut/');
});

// getLastWebPreferences() doesn't report preload, devTools or navigateOnDragDrop;
// test/security-config.test.ts covers those, and the bridge test proves the preload ran.
test('web preferences read back locked down', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents as unknown as
      WithLastWebPreferences | undefined;
    return contents?.getLastWebPreferences();
  });
  expect(prefs).toMatchObject({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    safeDialogs: true,
    javascript: true,
  });
  expect(prefs?.enableBlinkFeatures ?? '').toBe('');
});

test('app:// documents carry the strict CSP header', async () => {
  const fromMain = await app.evaluate(async ({ net }) => {
    const response = await net.fetch('app://taalcut/');
    return { status: response.status, csp: response.headers.get('content-security-policy') };
  });
  expect(fromMain).toEqual({ status: 200, csp: APP_CSP });
  expect(APP_CSP).toContain("script-src 'self';");
  expect(APP_CSP).toContain("frame-ancestors 'none'");

  const fromPage = await fetchFromPage(page, '/');
  expect(fromPage).toEqual({ status: 200, contentType: 'text/html; charset=utf-8', csp: APP_CSP });
});

test('the CSP is enforced: no inline script, no eval', async () => {
  expect(await cspBlocks(page)).toEqual({ inlineScriptRan: false, evalAllowed: false });
});

test('app:// falls back to index.html for routes and blocks traversal', async () => {
  expect((await fetchFromPage(page, '/projects/123')).status).toBe(200);
  expect((await fetchFromPage(page, '/assets/missing.js')).status).toBe(404);
  // The URL parser folds %2e%2e into ".." and drops it: this asks for /package.json, which isn't in the build.
  expect((await fetchFromPage(page, '/%2e%2e/%2e%2e/package.json')).status).toBe(404);
  // An encoded slash survives the parser; the handler decodes it and refuses the "..".
  expect((await fetchFromPage(page, '/..%2f..%2fpackage.json')).status).toBe(400);
});

test('the renderer has no Node: require and process are unreachable', async () => {
  const globals = await nodeGlobals(page);
  for (const [name, type] of Object.entries(globals)) expect(type, name).toBe('undefined');
  expect(await bridgeKeys(page)).toEqual(['connect']);
  expect(await preloadGlobals(page)).toEqual(['taalcutRpc', 'taalcutFiles']);
  // A File the page made has no path on disk.
  expect(
    await page.evaluate(() =>
      (window as unknown as { taalcutFiles: { pathFor(file: File): string | null } }).taalcutFiles.pathFor(
        new File(['x'], 'made-here.txt'),
      ),
    ),
  ).toBeNull();
});

test('the saved theme applies before the first frame (no flash)', async () => {
  const state = await app.evaluate(({ BrowserWindow, nativeTheme }) => ({
    source: nativeTheme.themeSource,
    background: BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
  }));
  expect(state.source).toBe('dark');
  expect(state.background?.toLowerCase()).toBe(DARK_CANVAS);
  expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
});

test('the theme round-trips over the theme contract and validates', async () => {
  expect(await page.evaluate(async () => (await window.taalcutProbe?.client)?.theme.get())).toEqual({
    preference: 'dark',
    resolved: 'dark',
  });
  // theme.changed starts with the current state, then every change, from any window.
  const changes = page.evaluate(async () => {
    const rpc = await window.taalcutProbe?.client;
    if (!rpc) return [];
    const seen: string[] = [];
    for await (const state of await rpc.theme.changed()) {
      seen.push(state.preference);
      if (seen.length === 2) break;
    }
    return seen;
  });
  await page.waitForTimeout(100);
  await page.evaluate(async () => (await window.taalcutProbe?.client)?.theme.set({ preference: 'light' }));
  expect(await changes).toEqual(['dark', 'light']);
  const state = await app.evaluate(({ BrowserWindow, nativeTheme }) => ({
    source: nativeTheme.themeSource,
    background: BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
  }));
  expect(state.source).toBe('light');
  expect(state.background?.toLowerCase()).toBe(LIGHT_CANVAS);
  // Saved as settings.setTheme on the agent's bus (audited and undoable).
  await expect.poll(() => savedTheme(userData)).toBe('light');

  const rejected = await page.evaluate(async () =>
    (await window.taalcutProbe?.client)?.theme.set({ preference: 'neon' as 'dark' }).then(
      () => 'resolved',
      (error: { data?: { code?: string } }) => error.data?.code,
    ),
  );
  expect(rejected).toBe('core.validation');
});

test("the native menu is labelled from main's catalogue, with the palette's shortcuts", async () => {
  const menu = await app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((item) => ({
      label: item.label,
      items: (item.submenu?.items ?? []).map((sub) => [sub.label, sub.accelerator ?? null]),
    })),
  );
  expect(menu.map((item) => item.label).slice(1)).toEqual(['Edit', 'View', 'Go', 'Window', 'Help']);
  // UX1: View leads with Back and Forward, as in Finder (menu/navigation.ts).
  expect(menu.find((item) => item.label === 'View')?.items.slice(0, 2)).toEqual([
    ['Back', 'CmdOrCtrl+['],
    ['Forward', 'CmdOrCtrl+]'],
  ]);
  expect(menu.find((item) => item.label === 'Go')?.items).toEqual([
    ['Make', 'CmdOrCtrl+1'],
    ['Library', 'CmdOrCtrl+2'],
    ['Templates', 'CmdOrCtrl+3'],
    ['Agent', 'CmdOrCtrl+4'],
  ]);
  expect(menu[0]?.items).toContainEqual(['Settings…', 'CmdOrCtrl+,']);
});

test("the native menu follows the app's language, with no restart (P3-L2)", async () => {
  const setLocale = (preference: string) =>
    page.evaluate(async (value) => {
      const rpc = await window.taalcutProbe?.client;
      if (!rpc) return 'no client';
      return rpc.commands
        .dispatch({ name: 'settings.setLocale', payload: { preference: value }, source: 'ui' })
        .then(
          () => 'ok',
          (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
        );
    }, preference);
  const topLabels = () =>
    app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? []).map((item) => item.label).slice(1));
  const MENUS = ['menu.edit', 'menu.view', 'menu.go', 'menu.window', 'menu.help'];
  for (const locale of ['hi', 'es', 'pt-BR'] as const) {
    const i18n = mainI18n(locale);
    expect(await setLocale(locale)).toBe('ok');
    await expect.poll(topLabels).toEqual(MENUS.map((id) => i18n._(id)));
  }
  expect(await setLocale('en')).toBe('ok');
  await expect.poll(topLabels).toEqual(['Edit', 'View', 'Go', 'Window', 'Help']);
});

test('navigation away and new windows are blocked', async () => {
  await page.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe('app://taalcut/');

  expect(await page.evaluate(() => window.open('https://example.com/') === null)).toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('permission requests are denied by default', async () => {
  expect(await page.evaluate(() => Notification.requestPermission())).toBe('denied');
  expect(
    await page.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state),
  ).toBe('denied');
});

test('a killed utility process is restarted within 2 s', async () => {
  const jobsPid = () =>
    app.evaluate(({ app: electronApp }) => {
      const metric = electronApp
        .getAppMetrics()
        .find((m) => m.type === 'Utility' && m.name === 'Taalcut jobs');
      return metric?.pid;
    });

  await expect.poll(jobsPid, { timeout: 5_000 }).toBeGreaterThan(0);
  const before = (await jobsPid()) as number;
  const killedAt = Date.now();
  process.kill(before, 'SIGKILL');

  await expect
    .poll(
      async () => {
        const pid = await jobsPid();
        return pid !== undefined && pid !== before;
      },
      { timeout: 2_000, intervals: [50] },
    )
    .toBe(true);
  expect(Date.now() - killedAt).toBeLessThan(2_000);
});
