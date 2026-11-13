// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Our window bar in the real app (DESIGN.md, "Window"): the test build with
 * the real renderer, so the bar's controls drive the BrowserWindow through
 * appContract.window. Each control is clicked and the window's state read
 * back from main: minimise, zoom (Option-click), full screen (controls hide,
 * the bar stays), close. Focus and blur dim the bar; a double-click on it
 * does what the title-bar setting says, given here with
 * --taalcut-double-click so macOS's own setting is never touched.
 * Screenshots (light, dark, pointed at, Option held, inactive, full screen) land in
 * test-results/window-bar/.
 *
 *   pnpm --filter @taalcut/desktop e2e:gate   (builds the renderer and the test build, then this)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { desktopDir, launchElectron } from './launch';

const SHOTS = join(desktopDir, 'test-results', 'window-bar');

interface Launched {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

/** The test build with a temporary profile and the title-bar double-click setting given. */
async function launch(doubleClick: string): Promise<Launched> {
  const userData = mkdtempSync(join(tmpdir(), 'taalcut-window-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'TAALCUT_RENDERER_URL',
    ),
  );
  const app = await launchElectron(userData, { env, colorScheme: null }, [
    `--taalcut-double-click=${doubleClick}`,
  ]);
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Live controls: the page is connected to main and has the window's state.
  await expect(page.getByRole('button', { name: 'Close window' })).toBeEnabled({ timeout: 30_000 });
  await setFocus(app, true);
  return { app, page, userData };
}

/**
 * The window gains or loses focus. A test run starts the app in the
 * background and macOS 14 and later won't let it take focus from the
 * terminal, so the window gets the focus or blur event macOS would send when
 * you click into it or into another app.
 */
async function setFocus(app: ElectronApplication, focused: boolean): Promise<void> {
  await app.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows()[0]?.emit(value ? 'focus' : 'blur');
  }, focused);
}

/** The main window's state as main sees it. */
function windowState(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    return {
      focused: win.isFocused(),
      maximized: win.isMaximized(),
      minimized: win.isMinimized(),
      fullScreen: win.isFullScreen(),
      visible: win.isVisible(),
    };
  });
}

/** The main window's bounds as main sees them. */
function windowBounds(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds() ?? null);
}

const bar = (page: Page) => page.locator('[data-slot=window-bar]').first();
const controls = (page: Page) => bar(page).getByRole('group', { name: 'Window controls' });

/**
 * The middle of the widest empty stretch of the bar, between whatever it holds (controls, the title, the
 * GitHub links on the right since the Kaatu v0.4 shell). A fixed offset from the right edge landed on a link.
 */
async function emptyBarPoint(page: Page): Promise<{ x: number; y: number }> {
  return bar(page).evaluate((el) => {
    const box = el.getBoundingClientRect();
    const taken = [...el.querySelectorAll('a, button, input, h1, h2, [role=group]')]
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.right > box.left && rect.left < box.right)
      .map((rect) => [Math.max(rect.left, box.left), Math.min(rect.right, box.right)] as const)
      .sort((a, b) => a[0] - b[0]);
    let best = { from: box.left, to: box.left };
    let cursor = box.left;
    for (const [left, right] of [...taken, [box.right, box.right] as const]) {
      if (left - cursor > best.to - best.from) best = { from: cursor, to: left };
      cursor = Math.max(cursor, right);
    }
    return { x: (best.from + best.to) / 2, y: box.top + box.height / 2 };
  });
}

let main: Launched;

// A capability (LNX1-PKG): this is the macOS bar's own controls. On Linux and Windows the system draws its
// controls over the bar (titleBarOverlay, src/platform/frame.ts); apps/renderer/e2e/linux.spec.ts checks that frame.
test.skip(
  process.platform !== 'darwin',
  "window bar: skipped, it drives the macOS bar's own controls; elsewhere the system draws them over the bar",
);
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  main = await launch('Minimize');
});

test.afterAll(async () => {
  await main?.app.close().catch(() => undefined);
  if (main) rmSync(main.userData, { recursive: true, force: true });
});

/** Puts the window in `theme` with the sidebar's toggle (it flips light and dark; Match the Mac takes two). */
async function chooseTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const html = page.locator('html');
  for (let i = 0; i < 2 && (await html.getAttribute('data-theme')) !== theme; i += 1) {
    await page.locator('[data-slot=sidebar] [data-slot=theme-toggle]').click();
    await expect(html).not.toHaveAttribute('data-theme-transition', /.*/);
  }
  await expect(html).toHaveAttribute('data-theme', theme);
}

test('the bar replaces the system title bar: our controls, the mark and the page’s name', async () => {
  const { page } = main;
  await expect(bar(page)).toBeVisible();
  expect((await bar(page).boundingBox())?.height).toBe(52);
  await expect(bar(page).getByRole('heading', { level: 1 })).toHaveText('Agent');
  await expect(controls(page).getByRole('button')).toHaveCount(3);
  // The bar drags the window; its controls don't.
  const region = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'));
  expect(await region('[data-slot=window-bar]')).toBe('drag');
  expect(await region('[data-slot=window-controls]')).toBe('no-drag');

  for (const theme of ['Light', 'Dark'] as const) {
    await chooseTheme(page, theme === 'Light' ? 'light' : 'dark');
    await page.screenshot({ path: join(SHOTS, `${theme.toLowerCase()}.png`) });
    await controls(page).hover();
    for (const glyph of await controls(page).locator('svg').all())
      await expect(glyph).toHaveCSS('opacity', '1');
    await bar(page).screenshot({ path: join(SHOTS, `${theme.toLowerCase()}-hover.png`) });
    await page.mouse.move(700, 400);
  }
  await chooseTheme(page, 'light');
});

test('dims when the window is not the active one, and comes back', async () => {
  const { app, page } = main;
  const html = page.locator('html');
  // The window starts as the active one here, whatever macOS did meanwhile: the app runs in the background, and
  // another app coming to the front since launch sends the window a real blur (IX3-F2).
  await setFocus(app, true);
  await expect(html).toHaveAttribute('data-window-active', 'true');
  const title = bar(page).locator('[data-slot=window-title]');
  const activeColour = await title.evaluate((el) => getComputedStyle(el).color);
  const disc = controls(page).locator('[data-kind=close] span').first();
  const fill = () => disc.evaluate((el) => getComputedStyle(el).backgroundColor);
  const activeFill = await fill();
  // The grey macOS gives the discs of a window that is not the active one (--color-window-inactive).
  const grey = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.backgroundColor = 'var(--color-window-inactive)';
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  });
  // Another app or window comes to the front.
  await setFocus(app, false);
  await expect(html).toHaveAttribute('data-window-active', 'false');
  // The title steps back to ink-3.
  await expect(title).not.toHaveCSS('color', activeColour);
  // The discs turn a flat grey.
  await expect(disc).toHaveCSS('background-color', grey);
  await bar(page).screenshot({ path: join(SHOTS, 'inactive.png') });

  // Pointing at the grey controls brings their colour back, as on macOS.
  await controls(page).hover();
  await expect(disc).toHaveCSS('background-color', activeFill);
  await bar(page).screenshot({ path: join(SHOTS, 'inactive-hover.png') });
  await page.mouse.move(700, 400);

  await setFocus(app, true);
  await expect(html).toHaveAttribute('data-window-active', 'true');
  await expect(disc).toHaveCSS('background-color', activeFill);
  await expect(title).toHaveCSS('color', activeColour);
});

test('Option-click on green zooms, and again unzooms', async () => {
  const { app, page } = main;
  // Zoom fills the screen, so the window starts smaller than the screen: at its minimum size, centred, which fits
  // every display the app runs on. A window can't be larger than the screen, so on a small display (1024 × 768,
  // say) the app opens filling it already, and zoom has nothing to do there.
  const sized = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('no window');
    const launched = win.getBounds();
    const [width = 0, height = 0] = win.getMinimumSize();
    const area = screen.getDisplayMatching(launched).workArea;
    const x = area.x + Math.round((area.width - width) / 2);
    win.setBounds({ x, y: area.y + Math.round((area.height - height) / 2), width, height });
    return { launched, small: win.getBounds() };
  });
  await expect.poll(async () => (await windowState(app))?.maximized).toBe(false);
  await page.keyboard.down('Alt');
  // Held, the green control says zoom and draws +.
  await controls(page).hover();
  await expect(controls(page).getByRole('button', { name: 'Zoom window' })).toBeVisible();
  await bar(page).screenshot({ path: join(SHOTS, 'option.png') });
  await controls(page)
    .getByRole('button', { name: 'Zoom window' })
    .click({ modifiers: ['Alt'] });
  await expect.poll(async () => (await windowState(app))?.maximized).toBe(true);
  expect((await windowBounds(app))?.width).toBeGreaterThan(sized.small.width);
  await controls(page)
    .getByRole('button', { name: 'Zoom window' })
    .click({ modifiers: ['Alt'] });
  await expect.poll(async () => (await windowState(app))?.maximized).toBe(false);
  // Back to the size it had before.
  await expect.poll(() => windowBounds(app)).toEqual(sized.small);
  await page.keyboard.up('Alt');
  await expect(controls(page).getByRole('button', { name: 'Enter full screen' })).toBeVisible();
  // The size it opened at, for the tests after this one.
  await app.evaluate(
    ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0]?.setBounds(bounds),
    sized.launched,
  );
});

test('green goes full screen: the controls hide, the bar stays', async () => {
  const { app, page } = main;
  // Record what the control asks of the window.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    const calls: boolean[] = [];
    const setFullScreen = win.setFullScreen.bind(win);
    Object.assign(globalThis, { fullScreenCalls: calls });
    win.setFullScreen = (flag: boolean) => {
      calls.push(flag);
      setFullScreen(flag);
    };
  });
  await controls(page).getByRole('button', { name: 'Enter full screen' }).click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as { fullScreenCalls?: boolean[] }).fullScreenCalls))
    .toEqual([true]);
  // macOS only takes a window full screen when its app is in front, and a test run's app is not
  // (it starts in the background). Then the window plays what macOS does: it is full screen and
  // says so (enter-full-screen), which is all the bar follows.
  const native = await expect
    .poll(async () => (await windowState(app))?.fullScreen, { timeout: 3_000 })
    .toBe(true)
    .then(() => true)
    .catch(() => false);
  if (!native) {
    test.info().annotations.push({ type: 'full screen', description: 'played: the app was not in front' });
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.isFullScreen = () => true;
      win.emit('enter-full-screen');
    });
  }
  await expect(bar(page).getByRole('group', { name: 'Window controls' })).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveAttribute('data-full-screen', 'true');
  expect(
    await bar(page).evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region')),
  ).not.toBe('drag');
  await page.screenshot({ path: join(SHOTS, 'full-screen.png') });

  // ⌃⌘F, the menu's Toggle Full Screen, is how you leave (the controls are hidden). A real full screen
  // is left once macOS has played its animation (leave-full-screen); the window can't minimise before.
  await app.evaluate(({ BrowserWindow }, played) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    if (played) {
      win.isFullScreen = () => false;
      win.emit('leave-full-screen');
      return Promise.resolve();
    }
    const left = new Promise<void>((resolve) => win.once('leave-full-screen', () => resolve()));
    win.setFullScreen(false);
    return Promise.race([left, new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
  }, !native);
  await expect.poll(async () => (await windowState(app))?.fullScreen, { timeout: 10_000 }).toBe(false);
  await expect(controls(page)).toBeVisible();
});

test('yellow minimises; a double-click on the bar does what the setting says (here: minimise)', async () => {
  const { app, page } = main;
  await controls(page).getByRole('button', { name: 'Minimize window' }).click();
  await expect.poll(async () => (await windowState(app))?.minimized, { timeout: 10_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.restore());
  await expect.poll(async () => (await windowState(app))?.minimized, { timeout: 10_000 }).toBe(false);

  // An empty part of the bar.
  const empty = await emptyBarPoint(page);
  await page.mouse.dblclick(empty.x, empty.y);
  await expect.poll(async () => (await windowState(app))?.minimized, { timeout: 10_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.restore());
  await expect.poll(async () => (await windowState(app))?.minimized, { timeout: 10_000 }).toBe(false);
});

test('red closes the window', async () => {
  const { app, page } = main;
  await controls(page).getByRole('button', { name: 'Close window' }).click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
});

test('with the setting at "None", a double-click on the bar does nothing', async () => {
  const quiet = await launch('None');
  try {
    const empty = await emptyBarPoint(quiet.page);
    const before = await windowState(quiet.app);
    await quiet.page.mouse.dblclick(empty.x, empty.y);
    // Give a wrong zoom or minimise time to happen.
    await quiet.page.waitForTimeout(800);
    expect(await windowState(quiet.app)).toEqual(before);
  } finally {
    await quiet.app.close().catch(() => undefined);
    rmSync(quiet.userData, { recursive: true, force: true });
  }
});
