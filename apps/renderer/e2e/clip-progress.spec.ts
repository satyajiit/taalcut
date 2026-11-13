// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-PROG: analysis progress people can read. The clip page says what the clip is good for already, what Taalcut
// does now and roughly how long is left, and groups the steps by what they give; the running step's own job moves
// its bar. Analyse again keeps the last results, marked as being redone, and can't be pressed twice. A clip held
// for a model says so and doesn't read as working; a failed step says where. The window bar counts the clips being
// analysed and opens on their queue, each a link to its page. Axe in both themes, the pseudo-locale, reduced motion.
// Clips are the fake library's (src/backend/fake/library), by id; fake-analysis.ts sends the stage fields.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { clippedText, englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { SAMPLE } from './clip-samples.ts';
import { CLIP } from './routes.ts';
import { FAKE_OPTIONS_KEY, fakeChat, open, preferences } from './support.ts';

const CLIPS = { justAdded: '01K7C5M6Q810000000000004RK', failed: '01K7C5M6Q810000000000000KR' } as const;
const REINDEX = 'library.reindexAssets';

/** The fake's handle (window.taalcutFake): its library's reads, its analysis's reports, the commands run. */
interface Fake {
  library: {
    library: { asset(id: string): Promise<{ stages: { stage: string; state: string }[] } | null> };
    analysis: { report(assetId: string, stage: string, fraction: number): void };
  };
  dispatched: { name: string }[];
}
const fake = (page: Page) =>
  page.evaluateHandle(() => (window as unknown as { taalcutFake: Fake }).taalcutFake);
const reindexed = (page: Page) =>
  page.evaluate(
    (name) =>
      (window as unknown as { taalcutFake: Fake }).taalcutFake.dispatched.filter((each) => each.name === name)
        .length,
    REINDEX,
  );

async function clip(page: Page, id: string): Promise<void> {
  await fakeChat(page, { indexingTickMs: 0 });
  await open(page, { name: 'library-asset', path: `/library/${id}` });
}

const status = (page: Page) => page.locator('[data-slot=clip-status]');
const groups = (page: Page) => status(page).locator('[data-slot=clip-groups] [data-group]');
const group = (page: Page, key: string) =>
  status(page).locator(`[data-slot=clip-groups] [data-group=${key}]`);

/** The running step's job says how far it is, as a job's progress event would. */
async function report(page: Page, id: string, fraction: number): Promise<string> {
  const handle = await fake(page);
  return handle.evaluate(
    async (f, { id, fraction }) => {
      const detail = await f.library.library.asset(id);
      const running = detail?.stages.find((stage) => stage.state === 'running');
      if (!running) throw new Error('no step runs');
      f.library.analysis.report(id, running.stage, fraction);
      return running.stage;
    },
    { id, fraction },
  );
}

test.describe('a clip’s analysis', () => {
  test('first analysis: what it’s good for, what runs now with its time left, and the job moving its bar', async ({
    page,
  }) => {
    await clip(page, CLIPS.justAdded);
    await expect(status(page).getByRole('heading', { level: 2 })).toHaveText(
      'Taalcut is still looking at this clip',
    );
    await expect(groups(page)).toHaveCount(6);
    await expect(status(page).locator('[data-slot=clip-groups] [data-state=now]')).toHaveCount(1);
    await expect(status(page).locator('[data-slot=clip-now]')).toContainText(/^Taalcut is .+\./);
    await expect(status(page).locator('[data-slot=clip-time-left]')).toHaveText(/^About .+ left$/);
    // Not a first analysis taken for Analyse again.
    await expect(status(page)).not.toHaveAttribute('data-again', 'true');
    await expect(page.locator('[data-slot=clip-stale]')).toHaveCount(0);

    const bar = status(page).locator('[data-slot=clip-groups] [data-state=now]').getByRole('progressbar');
    const before = Number(await bar.getAttribute('aria-valuenow'));
    await report(page, CLIPS.justAdded, 0.9);
    await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    // The steps one by one stay folded until asked for.
    await expect(status(page).getByRole('button', { name: 'Show the steps' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('Analyse again keeps the last results, says what is redone, and can’t be pressed twice', async ({
    page,
  }) => {
    await clip(page, CLIP);
    await expect(status(page)).toHaveAttribute('data-phase', 'complete');
    await expect(page.locator('[data-slot=clip-shot]')).toHaveCount(5);

    await page.getByRole('button', { name: 'More for this clip' }).click();
    await page.getByRole('menuitem', { name: 'Analyse again' }).click();
    await expect(status(page).getByRole('heading', { level: 2 })).toHaveText(
      'Taalcut is analysing this clip again',
    );
    await expect(status(page).locator('[data-slot=clip-again]')).toHaveText(
      'What Taalcut found last time stays until each part is redone.',
    );
    // What it found last time is still there, each part saying it is being redone.
    await expect(page.locator('[data-slot=clip-shot]')).toHaveCount(5);
    await expect(page.getByRole('heading', { name: 'What’s said' })).toBeVisible();
    const stale = page.locator('[data-slot=clip-stale]');
    await expect(stale.first()).toBeVisible();
    await expect(stale.first()).toContainText('From the last analysis. Taalcut is redoing it.');
    await expect(stale.first()).toHaveAttribute('aria-busy', 'true');
    await expect(status(page).locator('[data-slot=clip-groups] [data-redoing=true]')).not.toHaveCount(0);
    await expect(status(page).locator('[data-slot=clip-groups]')).toContainText('Redoing now');
    await expect(status(page).locator('[data-slot=clip-groups]')).toContainText('To redo');

    // Asked once: not offered again while Taalcut looks at it.
    await page.getByRole('button', { name: 'More for this clip' }).click();
    await expect(page.getByRole('menuitem', { name: 'Analyse again' })).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(await reindexed(page)).toBe(1);
  });

  test('a failed step says where it stopped; Analyse again is asked once, however fast it is pressed', async ({
    page,
  }) => {
    await clip(page, CLIPS.failed);
    await expect(status(page)).toHaveAttribute('data-phase', 'failed');
    await expect(group(page, 'shots')).toHaveAttribute('data-state', 'failed');
    await expect(group(page, 'shots')).toContainText('Didn’t work');
    const again = status(page).getByRole('button', { name: 'Analyse again' });
    await again.dblclick();
    await expect(status(page)).toHaveAttribute('data-phase', 'running');
    expect(await reindexed(page)).toBe(1);
  });

  test('waiting for a model: the groups it holds say so, and nothing reads as working', async ({ page }) => {
    await page.addInitScript(
      (key) => window.localStorage.setItem(key, JSON.stringify({ indexingTickMs: 0, models: 'missing' })),
      FAKE_OPTIONS_KEY,
    );
    await open(page, { name: 'library-asset', path: `/library/${SAMPLE.waitingForModels}` });
    await expect(status(page).locator('[data-slot=clip-groups] [data-state=model]')).not.toHaveCount(0);
    await expect(status(page).locator('[data-slot=clip-groups] [data-state=model]').first()).toContainText(
      'Waits for its model',
    );
    await expect(status(page).locator('[data-slot=clip-groups] [data-state=now]')).toHaveCount(0);
    await expect(status(page).locator('[data-slot=clip-now]')).toHaveCount(0);
    await expect(page.locator('[data-slot=clip-models-card]')).toBeVisible();
  });
});

test.describe('the window bar’s analysis', () => {
  const indicator = (page: Page) => page.locator('[data-slot=analysis-indicator]');
  const popover = (page: Page) => page.locator('[data-slot=analysis-popover]');

  test('counts the clips being analysed and opens on their queue, each a link to its page', async ({
    page,
  }) => {
    await fakeChat(page, { indexingTickMs: 0 });
    await open(page, { name: 'library', path: '/library' });
    const button = indicator(page).getByRole('button', { name: /^Clips being analysed: \d+$/ });
    await expect(button).toBeVisible();
    // Tiles being analysed say how far with a still line at the frame's foot, never over the picture.
    await expect(page.locator('[data-slot=clip-tile-progress]').first()).toBeAttached();

    await button.click();
    await expect(popover(page)).toBeVisible();
    await expect(popover(page).getByRole('heading', { level: 2 })).toHaveText(/^Analysing \d+ clips$/);
    await expect(popover(page).locator('[data-slot=analysis-time-left]')).toHaveText(/^About .+ left$/);
    await expect(popover(page).locator('[data-slot=analysis-most-left]')).toHaveText(
      /^Most of what’s left is .+\.$/,
    );
    const rows = popover(page).getByRole('list', { name: 'Clips being analysed' }).getByRole('link');
    await expect(rows).toHaveCount(6);
    await expect(popover(page).locator('[data-slot=analysis-queue-more]')).toHaveText(/^And \d+ more clips$/);

    const name = (await rows.first().textContent()) ?? '';
    await rows.first().click();
    await expect(page).toHaveURL(/\/library\/[0-9A-Z]{26}$/);
    await expect(page.locator('h1')).toContainText(name.split(/You can|Not searchable/)[0]?.trim() ?? '');
  });

  test('Escape closes it, focus goes back to the button, and closed it is no dialog', async ({ page }) => {
    await fakeChat(page, { indexingTickMs: 0 });
    await open(page, { name: 'library', path: '/library' });
    const button = indicator(page).getByRole('button');
    // Closed, it is no dialog: pages' Escape keys look for an open layer by role (use-review-keys.ts).
    await expect(page.locator('[data-slot=analysis-popover][role=dialog]')).toHaveCount(0);
    await button.click();
    await expect(popover(page)).toBeVisible();
    await expect(popover(page)).toHaveAttribute('role', 'dialog');
    await page.keyboard.press('Escape');
    await expect(popover(page)).toBeHidden();
    await expect(button).toBeFocused();
    await expect(page.locator('[data-slot=analysis-popover][role=dialog]')).toHaveCount(0);
  });

  test('reduced motion: the running group’s spinner slows and keeps turning; the queue still opens', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await clip(page, CLIPS.justAdded);
    const spinner = status(page).locator('[data-slot=clip-groups] [data-state=now] .animate-spin');
    await expect(spinner).toHaveCSS('animation-duration', '2.4s');
    await expect(spinner).toHaveCSS('animation-iteration-count', 'infinite');
    await indicator(page).getByRole('button').click();
    await expect(popover(page)).toBeVisible();
  });
});

test.describe('checked', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`axe, ${theme}: a first analysis, Analyse again and the queue`, async ({ page }, testInfo) => {
      await preferences(page, { theme });
      await clip(page, CLIPS.justAdded);
      await expectAccessible(page, testInfo, `first analysis (${theme})`);
      await page.goto(`/library/${CLIP}`);
      await page.getByRole('button', { name: 'More for this clip' }).click();
      await page.getByRole('menuitem', { name: 'Analyse again' }).click();
      await expect(page.locator('[data-slot=clip-stale]').first()).toBeVisible();
      await expectAccessible(page, testInfo, `Analyse again (${theme})`);
      await page.locator('[data-slot=analysis-indicator]').getByRole('button').click();
      await expect(page.locator('[data-slot=analysis-popover] [data-slot=analysis-queue]')).toBeVisible();
      await expectAccessible(page, testInfo, `the analysis queue (${theme})`);
    });
  }

  test.describe('pseudo-locale (en-XA) at the smallest window', () => {
    test.use({ viewport: { width: 1024, height: 720 } });
    const fits = async (page: Page) => {
      const text = (await userFacingText(page)).filter((found) => !found.where.endsWith('a > span @title'));
      expect(englishShowing(text, englishPhrases()), 'English source strings on screen').toEqual([]);
      expect(untranslated(text), 'strings that skipped the catalogue').toEqual([]);
      expect(await clippedText(page), 'text that does not fit').toEqual([]);
    };

    test('a first analysis, Analyse again and the queue: everything translated, nothing clipped', async ({
      page,
    }) => {
      await preferences(page, { locale: 'en-XA', theme: 'light' });
      await clip(page, CLIPS.justAdded);
      await expect(status(page).locator('[data-slot=clip-groups]')).toBeVisible();
      await fits(page);

      await page.goto(`/library/${CLIP}`);
      await expect(status(page)).toHaveAttribute('data-phase', 'complete');
      // Analyse again as the menu runs it (its words are pseudo-translated here).
      await page.evaluate(
        ({ name, id }) =>
          (
            window as unknown as {
              taalcutFake: { bus: { dispatch(n: string, p: unknown, o: unknown): Promise<unknown> } };
            }
          ).taalcutFake.bus.dispatch(name, { assetIds: [id] }, { source: 'ui', actor: 'user' }),
        { name: REINDEX, id: CLIP },
      );
      await expect(page.locator('[data-slot=clip-stale]').first()).toBeVisible();
      await fits(page);

      await page.locator('[data-slot=analysis-indicator]').getByRole('button').click();
      await expect(page.locator('[data-slot=analysis-popover] [data-slot=analysis-queue]')).toBeVisible();
      await fits(page);
    });
  });
});
