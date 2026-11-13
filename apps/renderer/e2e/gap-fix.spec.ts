// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B8 "Every gap has a fix": in the editor, a gap's "Fix this gap" opens its fixes and each sends its command
// (the phone page, the chat, library.importStock then timeline.fillGap, timeline.dropSlot with Undo); a failed
// import sends no fill; a refused stock search says why; the gapFix card folds what's fixed. Against the Make
// fakes with `gaps: { punch: 'golden' }`: Golden hour market's second video, slots 3 and 7 empty.
import { expect, test, type Page } from '@playwright/test';
import { showDetailedTimeline } from './editor-navigation';
import { axeFor } from './axe.ts';
import { backend } from './backend-driver.ts';
import { onTab } from './phone-flow-support.ts';
import { PROJECT } from './routes.ts';
import { expectAccessible, expectPseudoClean, shoot } from './ui2b-support.ts';
import { FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';

const VIDEO_2 = '01K7C5M6Q8N000000000000002';
/** FIX-ASK's card screenshots, for the lane's report (TAALCUT_SCREENS overrides). */
const SCREENS = process.env.TAALCUT_SCREENS ?? 'e2e-artifacts/fix-ask';
const EDITOR = { name: 'gaps', path: `/projects/${PROJECT}/timeline?timeline=${VIDEO_2}` };

const bed = (page: Page) => page.getByRole('listbox', { name: 'Clips' });
const gap = (page: Page, slot: number) =>
  bed(page).getByRole('option', { name: `Shot ${slot} is empty: fix this gap` });
const popover = (page: Page, slot: number) => page.getByRole('dialog', { name: `Fix shot ${slot}` });
const row = (page: Page, slot: number, kind: string) =>
  popover(page, slot).locator(`[data-slot=gap-fix][data-kind=${kind}]`);
const ran = async (page: Page) => (await backend.dispatched(page)).map((d) => `${d.name}:${d.source}`);

async function gapsFake(page: Page) {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ speed: 0, latencyMs: 0, gaps: { punch: 'golden' } }),
  });
}
const stockScenario = (page: Page, scenario: string) =>
  page.evaluate((next) => {
    const fake = (
      window as unknown as { taalcutFake?: { phase3: { stock: { setScenario(s: string): void } } } }
    ).taalcutFake;
    fake?.phase3.stock.setScenario(next);
  }, scenario);

test.beforeEach(async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await gapsFake(page);
});

test.describe('gap handling (P3-B8)', () => {
  test('a gap is an option of the bed: arrows reach it, Return opens its fixes, Escape gives focus back', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await open(page, EDITOR);
    await showDetailedTimeline(page);
    await expect(bed(page).locator('[data-slot=timeline-gap]')).toHaveCount(2);
    await bed(page).locator('[data-slot=timeline-clip]').nth(1).click();
    await page.keyboard.press('ArrowRight');
    await expect(gap(page, 3)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(popover(page, 3)).toBeVisible();
    await expect(popover(page, 3).getByRole('heading', { name: /^Shot 3 · / })).toBeVisible();
    await expect(row(page, 3, 'film')).toContainText('Add it to your shot list and film it on your phone.');
    await expect(row(page, 3, 'drop')).toContainText('The video becomes');
    await page.keyboard.press('Escape');
    await expect(popover(page, 3)).toHaveCount(0);
    await expect(gap(page, 3)).toBeFocused();
    // On to the next block and back: the gap is on the clips' roving path.
    await page.keyboard.press('ArrowRight');
    await expect(bed(page).locator('[data-slot=timeline-clip]').nth(2)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(gap(page, 3)).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('Film this opens the phone page', async ({ page }) => {
    await open(page, EDITOR);
    await showDetailedTimeline(page);
    await gap(page, 3).click();
    await row(page, 3, 'film').getByRole('button', { name: 'Open on your phone' }).click();
    // Film this links to /library/phone, where every link to the phone lands; with no phone connected that index
    // replaces itself with the Wi-Fi tab (lane phone, UX1). Wait for the tab itself, not the index on its way.
    await onTab(page, 'wifi');
  });

  test('Generate an image asks the chat, with the slot as a chip', async ({ page }) => {
    await open(page, EDITOR);
    await showDetailedTimeline(page);
    await gap(page, 7).click();
    await row(page, 7, 'generate').getByRole('button', { name: 'Ask in chat' }).click();
    await expect(popover(page, 7)).toHaveCount(0);
    await expect(page.locator('[data-slot=project-chat] textarea')).toHaveValue(
      'Generate an image for shot 7',
    );
    await expect(page.locator('[data-slot=project-chat] [data-slot=selection-chip]')).toHaveCount(1);
  });

  test('stock: six results with licence, Use it imports, waits for its job, then fills the gap', async ({
    page,
  }) => {
    await open(page, EDITOR);
    await showDetailedTimeline(page);
    await gap(page, 3).click();
    await row(page, 3, 'stock').getByRole('button', { name: 'Find stock video' }).click();
    const results = popover(page, 3).getByRole('list', { name: 'Stock videos' });
    await expect(results.getByRole('listitem').first()).toBeVisible();
    expect(await results.getByRole('listitem').count()).toBeLessThanOrEqual(6);
    await expect(results.locator('[data-slot=licence-chip]').first()).toHaveText('Pexels licence');
    await expect(popover(page, 3).getByText('Videos from Pexels')).toBeVisible();
    await results.getByRole('button', { name: 'Use it' }).first().click();
    await expect(page.getByText('Shot 3: stock video from Pexels', { exact: true })).toBeVisible();
    await expect(bed(page).locator('[data-slot=timeline-gap]')).toHaveCount(1);
    const names = await ran(page);
    const imports = names.indexOf('library.importStock:ui');
    const fill = names.indexOf('timeline.fillGap:ui');
    expect(imports).toBeGreaterThanOrEqual(0);
    expect(fill).toBeGreaterThan(imports);
  });

  test('a failed import says why with Retry, and sends no timeline.fillGap', async ({ page }) => {
    await open(page, EDITOR);
    await showDetailedTimeline(page);
    await stockScenario(page, 'failing');
    await gap(page, 3).click();
    await row(page, 3, 'stock').getByRole('button', { name: 'Find stock video' }).click();
    await popover(page, 3).getByRole('button', { name: 'Use it' }).first().click();
    const alert = popover(page, 3).getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(await ran(page)).toContain('library.importStock:ui');
    expect(await ran(page)).not.toContain('timeline.fillGap:ui');
    await expect(bed(page).locator('[data-slot=timeline-gap]')).toHaveCount(2);
  });

  test('a refused stock search says why in one line (no key, Local only)', async ({ page }) => {
    await open(page, EDITOR);
    await showDetailedTimeline(page);
    for (const [scenario, words] of [
      ['noKey', 'Stock video needs your Pexels key in Settings → Accounts.'],
      ['localOnly', 'Stock video needs the internet, and Local only is on.'],
    ] as const) {
      await stockScenario(page, scenario);
      await gap(page, 3).click();
      await row(page, 3, 'stock').getByRole('button', { name: 'Find stock video' }).click();
      await expect(row(page, 3, 'stock').locator('[data-slot=gap-unavailable]')).toHaveText(
        new RegExp(words),
      );
      await page.keyboard.press('Escape');
    }
  });

  test('Drop this shot ripples, with Undo', async ({ page }) => {
    await open(page, EDITOR);
    await showDetailedTimeline(page);
    const before = await bed(page).getByRole('option').count();
    await gap(page, 7).click();
    await row(page, 7, 'drop').getByRole('button', { name: 'Drop this shot' }).click();
    await expect(bed(page).getByRole('option')).toHaveCount(before - 1);
    expect(await ran(page)).toContain('timeline.dropSlot:ui');
    // The toast's Undo for this drop; the transport's Undo (UX4) is on screen too and does the same.
    await page.locator('[data-slot=toast]').getByRole('button', { name: 'Undo' }).click();
    await expect(bed(page).getByRole('option')).toHaveCount(before);
    await expect(gap(page, 7)).toBeVisible();
  });

  test('?panel=gaps opens the first gap', async ({ page }) => {
    await open(page, { ...EDITOR, path: `${EDITOR.path}&panel=gaps` });
    await expect(popover(page, 3)).toBeVisible();
  });

  test('the gapFix card folds what is fixed and says why fixes are missing (/dev/kit)', async ({ page }) => {
    await open(page, { name: 'kit', path: '/dev/kit' });
    const partly = page.locator('figure[data-fixture="gapFix · partly"]');
    await expect(partly.getByText('Fixed 2 of 3 gaps')).toBeVisible();
    await expect(partly.getByText('Shot 7: dropped')).toBeVisible();
    const open_ = page.locator('figure[data-fixture="gapFix · open"]');
    await expect(open_.getByText('Stock video needs your Pexels key in Settings → Accounts.')).toBeVisible();
    await expect(
      open_.getByText('Generating an image needs the internet, and Local only is on.'),
    ).toBeVisible();
    const asking = page.locator('figure[data-fixture="gapFix · asking"]');
    await asking
      .locator('[data-slot=gap-fix][data-kind=generate]')
      .first()
      .getByRole('button', { name: 'Choose' })
      .click();
    await expect(asking.getByRole('button', { name: /^Generate 1 image · about / })).toBeEnabled();
  });
});

test.describe("FIX-ASK: what the footage can't fill (/dev/kit)", () => {
  const KIT = { name: 'kit', path: '/dev/kit' };
  const owner = (page: Page) => page.locator('figure[data-fixture="gapFix · ownerAsking"]');
  const shot = (page: Page, n: number) =>
    owner(page)
      .locator('[data-slot=gap]')
      .filter({ has: page.getByRole('heading', { name: new RegExp(`^Shot ${n} · `) }) });

  test('says what is wrong, offers the clip from another shot, and starts with the proposals chosen', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await open(page, KIT);
    await expect(owner(page).getByRole('heading', { name: '3 shots need a look' })).toBeVisible();
    await expect(owner(page).locator('[data-slot=gap-summary]')).toHaveText(
      'This video needs 13 clips. 12 of yours fit, so 1 shot has nothing. Taalcut isn’t sure of 2 clips.',
    );
    await expect(owner(page).locator('[data-slot=gap-why]')).toContainText('The opening shot sets the hook');
    await expect(shot(page, 9).locator('[data-slot=gap-wants]')).toHaveText(
      'None of your clips shows hands paying at a market stall.',
    );
    await expect(shot(page, 9).locator('[data-slot=gap-closest]')).toContainText('now in shot 5');
    const borrow = shot(page, 1).locator('[data-slot=gap-fix][data-kind=borrow]');
    await expect(borrow).toContainText('now in shot 3. Shot 3 gets');
    await expect(borrow.getByRole('button', { name: 'Chosen' })).toHaveAttribute('aria-pressed', 'true');
    await expect(shot(page, 9).locator('[data-slot=gap-fix][data-kind=reuse]')).toContainText(
      'the clip in shot 5',
    );
    const add = shot(page, 9).locator('[data-slot=gap-fix][data-kind=addClips]');
    await expect(add.getByRole('button', { name: 'From this Mac' })).toBeVisible();
    await expect(add.getByRole('button', { name: 'From your phone' })).toBeVisible();
    await expect(owner(page).locator('[data-slot=gap-chat-hint]')).toBeVisible();
    // Taking the proposals is one press; the kit's answer goes nowhere, and the card says it went.
    await owner(page).getByRole('button', { name: 'Fix 3 gaps' }).click();
    await expect(owner(page).getByRole('status').filter({ hasText: 'Fixing 3 gaps…' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('after Add more clips, and what autopilot did, said plainly', async ({ page }) => {
    await open(page, KIT);
    const added = page.locator('figure[data-fixture="gapFix · clipsAdded"]');
    await expect(added.locator('[data-slot=gap-new-clips]')).toHaveText(
      'You added 2 clips; 1 is ready so far. Taalcut used 0 of them.',
    );
    const auto = page.locator('figure[data-fixture="gapFix · autopilotSettled"]');
    await expect(
      auto.getByText('Shot 1: took the clip from shot 3, which got another clip instead'),
    ).toBeVisible();
    await expect(
      auto.getByText('Shot 4: kept as it is. None of your other clips fits it better.'),
    ).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const)
    test(`the asking card, accessible in ${theme}`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      // Tall enough for the whole card: the kit scrolls inside the shell, which an element shot would clip.
      await page.setViewportSize({ width: 1100, height: 3400 });
      await open(page, KIT);
      await owner(page).scrollIntoViewIfNeeded();
      await expectAccessible(
        page,
        testInfo,
        `gap ask card (${theme})`,
        axeFor(page).include('figure[data-fixture="gapFix · ownerAsking"]'),
      );
      await owner(page).screenshot({ path: testInfo.outputPath(`fix-ask-card-${theme}.png`) });
      await owner(page).screenshot({ path: `${SCREENS}/fix-ask-card-${theme}.png` });
    });
});

for (const theme of ['light', 'dark'] as const) {
  test(`accessible in ${theme}, the popover open with stock results`, async ({ page }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    await open(page, EDITOR);
    await showDetailedTimeline(page);
    await expectAccessible(page, testInfo, `editor with gaps (${theme})`);
    await gap(page, 3).click();
    await row(page, 3, 'stock').getByRole('button', { name: 'Find stock video' }).click();
    await expect(popover(page, 3).getByRole('list', { name: 'Stock videos' })).toBeVisible();
    await expectAccessible(page, testInfo, `gap popover (${theme})`);
    await shoot(page, `gap-popover-${theme}`);
  });
}

test('the pseudo-locale: the popover translated, nothing clipped', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en-XA' });
  await open(page, EDITOR);
  await showDetailedTimeline(page);
  await page.locator('[data-slot=video-track] [data-slot=timeline-gap]').first().click();
  await expect(page.locator('[data-slot=gap-fix-popover]')).toBeVisible();
  await page.locator('[data-slot=gap-fix][data-kind=stock] button').click();
  await expect(page.locator('[data-slot=stock-result]').first()).toBeVisible();
  // The popover alone: the editor's own strip labels truncate by design and the shell's footer is a known red.
  await page.evaluate(() => {
    for (const el of document.body.children)
      if (el instanceof HTMLElement && !el.querySelector('[data-slot=gap-fix-popover]'))
        el.style.display = 'none';
  });
  await expectPseudoClean(page, 'gap popover');
});
