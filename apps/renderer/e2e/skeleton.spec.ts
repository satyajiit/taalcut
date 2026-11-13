// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P1-H2 "Done when": every async route shows a skeleton within 100 ms (PRD R32). UX1 W2-1: every page, not
// just the conversation. Two waits, two checks:
// - a page's code (each route is its own chunk): every route in e2e/routes.ts shows its page's bones within
//   100 ms while its code is held back, and the page replaces them (router.ts defaultPendingComponent)
// - a page's data: each route lists the named skeletons it shows while its reads are slowed (routes.ts
//   `skeletons`); a lane that captures a page's bones lists them there, or the first check below fails. The
//   page's clock stands still while it navigates, so these check that nothing is waited for before the bones,
//   not how fast the machine is (UX2 round 1: 209 to 216 ms of wall clock under load 35 to 60, old code alike)
import { readdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ROUTES, type RouteSample } from './routes.ts';
import { FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';

const BUDGET_MS = 100;
/** How long the next page's code is held back. */
const CODE_DELAY_MS = 1500;
/**
 * A bone of the view shown while a page's code loads: the router's page skeleton (shell-states/page-skeleton.tsx),
 * or the route's own pending view, a named skeleton (the clip page's).
 */
const PAGE_BONES = '[data-slot=page-skeleton] .tc-bone, [data-boneyard][aria-busy="true"] .tc-bone';

/**
 * Navigates inside the app, as a link or the Back button does, and resolves with the time until a bone
 * matching `selector` is on screen (measured at the next frame).
 */
function timeToBones(page: Page, path: string, selector: string): Promise<number> {
  return page.evaluate(
    ({ path, selector }) =>
      new Promise<number>((resolve) => {
        const start = performance.now();
        const visible = () =>
          [...document.querySelectorAll<HTMLElement>(selector)].some((bone) => {
            const box = bone.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          });
        const done = () => {
          observer.disconnect();
          requestAnimationFrame(() => resolve(performance.now() - start));
        };
        const observer = new MutationObserver(() => visible() && done());
        observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        window.history.pushState(window.history.state, '', path);
        window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
      }),
    { path, selector },
  );
}

/** Navigates inside the app, as a link or the Back button does. */
async function navigate(page: Page, path: string): Promise<void> {
  await page.evaluate((path) => {
    window.history.pushState(window.history.state, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }, path);
}

/**
 * Stops the page's clock: from here no timer, interval or animation frame of the page fires and its Date stands
 * still, until `page.clock.resume()`. What the page does without waiting still happens (rendering, its reads'
 * messages, its code from the browser's cache). The installed clock runs on until it is paused, so it pauses a
 * little ahead of the page's time (the timers due before then, the library's, run first).
 */
async function stopTheClock(page: Page): Promise<number> {
  await page.clock.install();
  const at = (await page.evaluate(() => Date.now())) + 2_000;
  await page.clock.pauseAt(at);
  return at;
}

/** Holds back every script the page asks for from now on: the next page's code is on its way. */
async function slowCode(page: Page): Promise<void> {
  await page.route('**/assets/*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, CODE_DELAY_MS));
    await route.continue();
  });
}

/** Where to start from: somewhere whose code has loaded, and not the page itself. */
const startFor = (route: RouteSample): RouteSample =>
  route.name === 'library' ? { name: 'chat', path: '/chat' } : { name: 'library', path: '/library' };

// Not found pages have no code of their own: the root's message shows at once.
const codeSplit = ROUTES.filter((route) => !route.name.startsWith('not-found'));

test.describe("while a page's code loads", () => {
  for (const route of codeSplit) {
    test(`${route.name}: the page's bones within ${BUDGET_MS} ms, then the page`, async ({ page }) => {
      const problems = await watchProblems(page);
      await preferences(page, { locale: 'en', theme: 'light' });
      await open(page, startFor(route));
      await slowCode(page);

      const elapsed = await timeToBones(page, route.path, PAGE_BONES);
      expect(elapsed, `bones after ${Math.round(elapsed)} ms`).toBeLessThan(BUDGET_MS);
      // The bar holds one title, never the leaving page's beside the next one's, shown or hidden.
      expect(
        await page.locator('[data-slot=window-bar] [data-slot=window-title]').count(),
      ).toBeLessThanOrEqual(1);
      // The bones say they are busy, and the page then replaces them.
      await expect(page.locator('[aria-busy="true"]').first()).toBeAttached();
      await expect(page.locator(PAGE_BONES)).toHaveCount(0, { timeout: 15_000 });
      expect(problems).toEqual([]);
    });
  }

  test('at launch, the sidebar and the page are bones while the shell’s code loads', async ({ page }) => {
    const problems = await watchProblems(page);
    await preferences(page, { locale: 'en', theme: 'dark' });
    await page.route('**/assets/_shell-*.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, CODE_DELAY_MS));
      await route.continue();
    });
    await page.goto('/library');
    // The window bar is up; under it, the sidebar's own colour and rows, and the library's tiles.
    await expect(page.locator('[data-slot=window-bar]')).toBeVisible();
    await expect(page.locator('[data-slot=sidebar-skeleton]')).toBeVisible();
    await expect(page.locator('[data-slot=page-skeleton][data-shape=grid] .tc-bone').first()).toBeVisible();
    await expect(page.locator('[data-slot=window-title]')).toHaveText('Library');
    // Then the real sidebar takes the skeleton's place.
    await expect(page.locator('[data-slot=sidebar]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-slot=sidebar-skeleton]')).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});

const dataRoutes = ROUTES.filter((route) => route.skeletons?.length);
const marked = new Set(dataRoutes.flatMap((route) => route.skeletons ?? []));
/** Every skeleton with bones captured from its real layout (e2e/capture-bones.mjs writes src/bones). */
const captured = readdirSync(new URL('../src/bones/', import.meta.url))
  .filter((file) => file.endsWith('.bones.json'))
  .map((file) => file.replace(/\.bones\.json$/, ''));
/** Captured skeletons no route lists, and why. */
const UNMARKED: Readonly<Record<string, string>> = {
  'chat-conversations': 'the sidebar’s recent chats load once at launch, not when you go to a page',
  'phone-history': 'the fake has no option to slow library.sources',
  'hub-list': 'the hub fake has no option to slow its reads',
  'hub-template': 'the hub fake has no option to slow its reads',
  'start-cards': 'the starters and formats fakes have no option to slow their reads',
  'templates-saved': 'the Instagram fake has no option to slow its reads',
  'settings-usage': 'the totals’ bones wait 300 ms on purpose, so a quick answer doesn’t flash them',
  'settings-usage-breakdown': 'its tables wait 300 ms as the totals do, so a quick answer doesn’t flash them',
};

/** The fakes' reads wait this long, so a page's skeleton stays up: the chat's, and the library's and Make's. */
const SLOW_READS = { latencyMs: 1500, libraryLatencyMs: 1500 };
/** Each message on the fake backend's MessageChannel waits this long once cued (a read: twice). */
const SLOW_BACKEND_MS = 750;
/** Settings' fakes answer at once, with no latency option: their reads are slowed on the channel instead. */
const cuesBackend = (route: RouteSample): boolean => route.name.startsWith('settings');

/**
 * Settings reads the fake backend over a MessageChannel, which answers at once (lane settings). From the moment the
 * test sets `__taalcutSlowBackendMs`, each message on it waits that long, so those routes' skeletons have a gap to
 * fill (the app itself has started at full speed by then).
 */
async function slowBackendOnCue(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (this: MessagePort, ...args: unknown[]) {
      const ms = Number(Reflect.get(window, '__taalcutSlowBackendMs') ?? 0);
      // React's scheduler posts null on its own MessageChannel: that one stays at full speed.
      if (ms > 0 && args[0] != null) setTimeout(() => Reflect.apply(post, this, args), ms);
      else Reflect.apply(post, this, args);
    };
  });
}
/** Skeletons whose wait is something else: the phone flow's, while the Wi-Fi session starts. */
const SLOWER: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'phone-status': { transfer: 'waiting', transferStartMs: 1500 },
  'phone-pairing': { transfer: 'waiting', transferStartMs: 1500 },
};

test.describe("while a page's data loads", () => {
  test('every captured skeleton is checked on a route, and every route’s skeleton is captured', () => {
    for (const name of marked) expect(captured, `bones for "${name}"`).toContain(name);
    const unchecked = captured.filter((name) => !marked.has(name) && !(name in UNMARKED));
    expect(unchecked, 'captured skeletons no route in e2e/routes.ts lists').toEqual([]);
  });

  for (const route of dataRoutes) {
    for (const name of route.skeletons ?? []) {
      test(`${route.name}: "${name}" skeleton with nothing waited for (within ${BUDGET_MS} ms on any Mac)`, async ({
        page,
      }) => {
        const problems = await watchProblems(page);
        await preferences(page, { locale: 'en', theme: 'light' });
        await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
          key: FAKE_OPTIONS_KEY,
          value: JSON.stringify({ ...SLOW_READS, ...SLOWER[name] }),
        });
        const cued = cuesBackend(route);
        if (cued) await slowBackendOnCue(page);
        // The page's code first, so this times its data alone (the check above times the wait for code): open the
        // page once, so the browser has its code, then start again at the library with nothing held in memory (a
        // conversation the app keeps would show at once on the way back, with no skeleton to time).
        await open(page, route);
        await open(page, { name: 'library', path: '/library' });
        if (cued)
          await page.evaluate((ms) => Reflect.set(window, '__taalcutSlowBackendMs', ms), SLOW_BACKEND_MS);

        // PRD R32's 100 ms is a budget for waiting: a page that holds its skeleton back (a timer, a frame, a read
        // it waits for) leaves you on a blank or stale page. With the page's clock stopped, none of those can
        // happen, and the slowed reads stay unanswered: the skeleton has to come from the work of drawing the
        // page alone, so it is within the budget on any machine, however busy.
        const stopped = await stopTheClock(page);
        await navigate(page, route.path);
        const selector = `[data-boneyard="${name}"][aria-busy="true"] .tc-bone`;
        await expect(page.locator(selector).first()).toBeVisible();
        // The bones captured from the real layout (src/bones), not just the generic lines.
        await expect(page.locator(`[data-boneyard="${name}"] [data-boneyard-bone]`).first()).toBeVisible();
        expect(await page.evaluate(() => Date.now()), 'no time passed on the page').toBe(stopped);
        // Then time runs again, the reads answer, and the data replaces it.
        await page.clock.resume();
        await expect(page.locator(`[data-boneyard="${name}"]`)).not.toHaveAttribute('aria-busy', 'true', {
          timeout: 5_000,
        });
        expect(problems).toEqual([]);
      });
    }
  }
});
