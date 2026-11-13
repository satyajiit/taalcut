// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// BRK1-REV "Done when": the breakdown card is a summary and the review is where a breakdown is judged and fixed:
// the kept reel playing slot by slot, J and K through what Taalcut isn't sure of, Looks right, cuts dragged on the
// beat or nudged from the keyboard, Tell Taalcut's proposals accepted one by one, every fix one command that ⌘Z
// undoes. In the chat's sheet (portrait and landscape reels, 960 × 600) and on a template's Slots page. The fake's
// reels are synthetic (e2e/sample-media/make-reels.mjs); the chats are seeded (src/chat/fake-seed-review.ts).
import { expect, test } from '@playwright/test';
import { open, preferences, screenshotWhole, watchProblems } from './support.ts';
import { expectAccessible, expectPseudoClean, fakes } from './ui2b-support.ts';
import {
  card,
  count,
  heading,
  LANDSCAPE,
  openSheet,
  PORTRAIT,
  ran,
  sheet,
  shot,
} from './template-review-support.ts';

/**
 * The two reels (src/backend/fake/templates/template-review-plans.ts): Rainy market walk, portrait, 7 things to
 * check; Coast road trip, landscape, 5. Each has a seeded chat and its Slots page.
 */
const SHAPES = [
  {
    shape: 'portrait',
    chat: PORTRAIT,
    slots: { name: 'templates-template-slots', path: '/templates/01K7C5M6Q85000000000000006/slots' },
    toCheck: '7 to check',
  },
  {
    shape: 'landscape',
    chat: LANDSCAPE,
    slots: { name: 'templates-template-slots', path: '/templates/01K7C5M6Q85000000000000007/slots' },
    toCheck: '5 to check',
  },
] as const;

test.beforeEach(async ({ page }) => {
  await fakes(page, { speed: 6 });
});

test.describe('the template review (BRK1-REV)', () => {
  for (const theme of ['light', 'dark'] as const)
    test(`the card is a summary; Review the reel opens the review over the chat (${theme})`, async ({
      page,
    }, testInfo) => {
      const problems = await watchProblems(page);
      await preferences(page, { theme, locale: 'en' });
      await page.setViewportSize({ width: 960, height: 600 });
      await open(page, PORTRAIT);
      const summary = card(page).locator('[data-slot=breakdown-summary]');
      await expect(summary).toBeVisible({ timeout: 15_000 });
      await expect(summary.locator('[data-slot=reel-filmstrip] [data-unsure]')).toHaveCount(2);
      await expect(summary.locator('[data-slot=breakdown-to-check]')).toHaveText(
        '7 to check: 2 cuts Taalcut isn’t sure of, 1 slot that may be a fade, 1 vague description, 1 line of text that may be part of the scene, and 2 things about the sound.',
      );
      await expectAccessible(page, testInfo, `breakdown card (${theme})`);
      await card(page).screenshot({ path: new URL(shot(`card-portrait-${theme}`)).pathname });

      await openSheet(page);
      await expect(page.getByRole('dialog', { name: 'Review the reel: Rainy market walk' })).toBeVisible();
      // It opens on the first thing to check, the reel's tempo, with focus on the selected slot: Space plays the reel
      // there rather than pressing Done.
      await expect(sheet(page).locator('[data-slot=reel-doubts]')).toBeVisible();
      await expect(sheet(page).getByRole('option', { selected: true })).toBeFocused();
      await page.keyboard.press('Space');
      await expect(sheet(page)).toBeVisible();
      await page.keyboard.press('Space');
      await expect(count(page)).toContainText('7 to check');
      // At 960 × 600 the Fix menu stays inside the sheet.
      await sheet(page).getByRole('button', { name: 'Fix' }).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      const [inside, outside] = [await menu.boundingBox(), await sheet(page).boundingBox()];
      expect(inside!.y).toBeGreaterThanOrEqual(outside!.y);
      expect(inside!.y + inside!.height).toBeLessThanOrEqual(outside!.y + outside!.height);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expectAccessible(page, testInfo, `review sheet (${theme})`);
      await page.screenshot({ path: new URL(shot(`sheet-portrait-960-${theme}`)).pathname });
      // Done closes it; the chat is where it was, and focus goes back to the card's button.
      await sheet(page).getByRole('button', { name: 'Done' }).click();
      await expect(sheet(page)).toHaveCount(0);
      await expect(card(page).getByRole('button', { name: 'Review the reel' })).toBeFocused();
      expect(problems).toEqual([]);
    });

  test('J and K step through what to check; each answer and Looks right move on; ⌘Z undoes', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, PORTRAIT);
    await openSheet(page);
    // The tempo is right: Leave it as it is takes the doubt and goes on to the reel's next one, its sound's credit.
    const reelDoubts = sheet(page).locator('[data-slot=reel-doubts]');
    await reelDoubts.locator('[data-current]').getByRole('button', { name: 'Leave it as it is' }).click();
    await expect(count(page)).toContainText('6 to check');
    await expect(reelDoubts.locator('[data-current]')).toContainText(
      'The reel doesn’t say whose sound it is',
    );
    // Focus goes on to the heading of what is current, never a button: Space there would answer it unseen.
    await expect(reelDoubts.getByRole('heading', { name: 'The whole reel' })).toBeFocused();
    await page.keyboard.press('j');
    await expect(heading(page)).toHaveText('Slot 3 of 10');
    await expect(
      sheet(page).getByText('The description doesn’t say what moves', { exact: true }),
    ).toBeVisible();
    // A screen reader hears where J went.
    await expect(sheet(page).locator('[data-slot=review-current]')).toHaveText(
      'Slot 3: The description doesn’t say what moves',
    );
    await sheet(page).getByRole('button', { name: 'Slot 3 looks right' }).click();
    await expect(count(page)).toContainText('5 to check');
    await expect(count(page)).toContainText('1 approved');
    // On to slot 4's sign; K goes back to what is left about the whole reel.
    await expect(heading(page)).toHaveText('Slot 4 of 10');
    await page.keyboard.press('k');
    await expect(reelDoubts.locator('[data-current]')).toContainText(
      'The reel doesn’t say whose sound it is',
    );
    await page.keyboard.press('ControlOrMeta+z');
    await expect(count(page)).toContainText('0 approved');
    expect(await ran(page)).toEqual(['template.doubt.dismiss', 'template.slot.approve']);
  });

  test('a slot picked on the strip is what Looks right approves; Escape in an edit stays in the sheet', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, PORTRAIT);
    await openSheet(page);
    // The reel's tempo is current; the person picks slot 7 and says it looks right: slot 7 is approved.
    await sheet(page)
      .getByRole('option', { name: /^Slot 7/ })
      .click();
    await sheet(page).getByRole('button', { name: 'Slot 7 looks right' }).click();
    await expect(count(page)).toContainText('1 approved');
    await expect(sheet(page).getByRole('option', { name: /^Slot 7.*Approved/ })).toBeVisible();
    expect(await ran(page)).toEqual(['template.slot.approve']);

    // Fix › Rename puts the caret in the name; Escape leaves the name, not the sheet; the next Escape closes it.
    await sheet(page).getByRole('button', { name: 'Fix' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await expect(sheet(page).getByRole('textbox', { name: /^Name for slot/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet(page).getByRole('textbox', { name: /^Name for slot/ })).toHaveCount(0);
    await expect(sheet(page)).toBeVisible();
    // Fix › Move the cut hands focus to the cut: the arrows move it, Escape puts it back and keeps the sheet.
    await sheet(page).getByRole('button', { name: 'Fix' }).click();
    await page.getByRole('menuitem', { name: /^Move the cut before slot/ }).click();
    const cut = sheet(page).getByRole('slider', { name: /^Cut before slot/ });
    await expect(cut).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
  });

  test('a cut dragged on the strip snaps to the beat, and the keyboard moves one too', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, PORTRAIT);
    await openSheet(page);
    // Slot 5's cut, which Taalcut isn't sure of.
    await sheet(page)
      .getByRole('option', { name: /^Slot 5/ })
      .click();
    const cut = sheet(page).getByRole('slider', { name: 'Cut before slot 5' });
    await expect(cut).toBeVisible();
    const box = (await cut.boundingBox())!;
    const strip = (await sheet(page).locator('[data-slot=slot-strip]').boundingBox())!;
    const perSecond = strip.width / 10;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Half a second earlier, a pixel off the beat: it lands on the beat.
    await page.mouse.move(box.x + box.width / 2 - perSecond * 0.5 + 1, box.y + box.height / 2, { steps: 6 });
    await expect(sheet(page).locator('[data-slot=cut-handle][data-moving]')).toContainText('4.00s · beat 9');
    await page.mouse.up();
    await expect.poll(() => ran(page)).toEqual(['template.slot.moveCut']);
    // The cut doubt went with the move.
    await expect(count(page)).toContainText('6 to check');

    // From the keyboard: the selected slot's cut is a slider; Shift moves a beat, Enter keeps it.
    await cut.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(cut).toHaveAttribute('aria-valuetext', /on beat 10/);
    await page.keyboard.press('Enter');
    await expect.poll(() => ran(page)).toEqual(['template.slot.moveCut', 'template.slot.moveCut']);
  });

  test('Not text takes out a sign OCR read; the review says so beside its Undo', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, PORTRAIT);
    await openSheet(page);
    await sheet(page)
      .getByRole('option', { name: /^Slot 4/ })
      .click();
    const texts = () => sheet(page).getByRole('list', { name: 'Text on screen in this slot' });
    await expect(texts()).toContainText('OPEN 24H');
    await texts().getByRole('button', { name: 'Not text' }).click();
    // The sign was the slot's thing to check: the review goes on to the next one, slot 5's unsure cut, and focus
    // lands on its heading rather than falling to the sheet (or on a button Space would press).
    await expect(heading(page)).toHaveText('Slot 5 of 10');
    await expect(heading(page)).toBeFocused();
    // A modal sheet: the page's toasts can't be reached under it, so the review says it beside its own Undo.
    await expect(sheet(page).locator('[data-slot=review-said]')).toHaveText('Text removed');
    await sheet(page).getByRole('button', { name: 'Undo' }).click();
    // Undo is said too, with what it took back.
    await expect(sheet(page).locator('[data-slot=review-said]')).toHaveText('Undone: Text removed');
    await sheet(page)
      .getByRole('option', { name: /^Slot 4/ })
      .click();
    await expect(texts()).toContainText('OPEN 24H');
    expect(await ran(page)).toEqual(['template.text.remove']);
    // Slot 5's unsure cut is answered beside it: It's a cut keeps it, and the review says so.
    await sheet(page)
      .getByRole('option', { name: /^Slot 5/ })
      .click();
    await sheet(page).getByRole('button', { name: 'It’s a cut' }).click();
    await expect(sheet(page).locator('[data-slot=review-said]')).toHaveText('The cut before slot 5 kept');
    expect((await ran(page)).at(-1)).toBe('template.doubt.dismiss');
  });

  test('Tell Taalcut answers proposals as a diff; nothing changes until one is accepted', async ({
    page,
  }, testInfo) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, PORTRAIT);
    await openSheet(page);
    await sheet(page)
      .getByRole('option', { name: /^Slot 6/ })
      .click();
    await sheet(page).getByRole('button', { name: 'Tell Taalcut' }).click();
    const tell = sheet(page).locator('[data-slot=tell-taalcut]');
    await tell.getByRole('textbox').fill('This is one shot, not a cut');
    await tell.getByRole('button', { name: 'Ask for changes' }).click();
    const proposal = tell.locator('[data-slot=proposal]').first();
    await expect(proposal).toContainText('Merge slots 5 to 6', { timeout: 10_000 });
    await expect(tell.locator('[data-slot=proposals-model]')).toContainText('went to OpenRouter');
    expect(await ran(page)).toEqual([]);
    await expectAccessible(page, testInfo, 'tell taalcut');
    await page.screenshot({ path: new URL(shot('sheet-tell-taalcut-light')).pathname });
    await proposal.getByRole('button', { name: 'Accept' }).click();
    await expect(proposal).toHaveAttribute('data-state', 'accepted');
    await expect(proposal).toContainText('Merge slots 5 to 6');
    expect(await ran(page)).toEqual(['template.slot.merge']);
    // Focus stays on the row, not the field: ⌘Z takes the change back, and the proposal is open again.
    await expect(proposal).toBeFocused();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(proposal).toHaveAttribute('data-state', 'open');
  });

  test('Tell Taalcut: each row says what the template holds, by hand or with Accept all', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, PORTRAIT);
    await openSheet(page);
    await sheet(page)
      .getByRole('option', { name: /^Slot 6/ })
      .click();
    await sheet(page).getByRole('button', { name: 'Tell Taalcut' }).click();
    const tell = sheet(page).locator('[data-slot=tell-taalcut]');
    await tell.getByRole('textbox').fill('This is one shot, not a cut, and the description is vague');
    await tell.getByRole('button', { name: 'Ask for changes' }).click();
    const rows = tell.locator('[data-slot=proposal]');
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
    await expect(rows.nth(0)).toContainText('Merge slots 5 to 6');
    await expect(rows.nth(1)).toContainText('Slot 6’s description');
    // By hand, the description and then the merge: the merge keeps slot 5's description, so the row says so.
    await rows.nth(1).getByRole('button', { name: 'Accept' }).click();
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'accepted');
    await rows.nth(0).getByRole('button', { name: 'Accept' }).click();
    await expect(rows.nth(0)).toHaveAttribute('data-state', 'accepted');
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'replaced');
    await expect(rows.nth(1)).toContainText('Replaced by the merge');
    // Focus stays on the answers, never the sheet.
    await expect(page.locator(':focus')).toHaveAttribute('data-slot', 'proposal');
    // ⌘Z twice: both open again.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(rows.nth(0)).toHaveAttribute('data-state', 'open');
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'accepted');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'open');
    // Accept all: the merge first, so the description it takes says it no longer applies, and isn't sent.
    await tell.getByRole('button', { name: 'Accept all 2' }).click();
    await expect(rows.nth(0)).toHaveAttribute('data-state', 'accepted');
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'gone');
    await expect(rows.nth(1)).toContainText('No longer applies');
    expect((await ran(page)).filter((name) => name !== 'template.setHead').at(-1)).toBe(
      'template.slot.merge',
    );
  });

  for (const theme of ['light', 'dark'] as const)
    test(`a landscape reel plays at its shape, looping the slot, the playhead with it (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await open(page, LANDSCAPE);
      await expect(card(page).locator('[data-slot=breakdown-summary]')).toBeVisible({ timeout: 15_000 });
      await expectAccessible(page, testInfo, `landscape card (${theme})`);
      await card(page).screenshot({ path: new URL(shot(`card-landscape-${theme}`)).pathname });
      await openSheet(page);
      const video = sheet(page).locator('[data-slot=reel-stage] video');
      await expect
        .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2);
      const ratio = await video.evaluate((el: HTMLVideoElement) => el.videoWidth / el.videoHeight);
      expect(ratio).toBeGreaterThan(1.5);
      // Picking a slot plays it round. Slot 8 runs 7.5 s to 8 s: the loop keeps the playhead inside it.
      await sheet(page)
        .getByRole('option', { name: /^Slot 8/ })
        .click();
      await expect(sheet(page).getByRole('button', { name: 'Pause' })).toBeVisible();
      await page.waitForTimeout(1200);
      const now = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
      expect(now).toBeGreaterThanOrEqual(7.45);
      expect(now).toBeLessThan(8.05);
      await sheet(page).getByRole('button', { name: 'Pause' }).click();
      await expectAccessible(page, testInfo, `landscape review (${theme})`);
      await page.screenshot({ path: new URL(shot(`sheet-landscape-${theme}`)).pathname });
      await page.setViewportSize({ width: 960, height: 600 });
      await page.screenshot({ path: new URL(shot(`sheet-landscape-960-${theme}`)).pathname });
    });

  test('the card fits a narrow chat column', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, LANDSCAPE);
    await expect(card(page).locator('[data-slot=breakdown-summary]')).toBeVisible({ timeout: 15_000 });
    // The editor's docked chat is about 22 rem wide.
    await card(page).evaluate((el) => {
      (el as HTMLElement).style.width = '22rem';
    });
    const overflow = await card(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await card(page).screenshot({ path: new URL(shot('card-landscape-narrow-light')).pathname });
  });

  for (const { shape, slots, toCheck } of SHAPES)
    for (const theme of ['light', 'dark'] as const)
      test(`the Slots page is the same review at page size (${shape}, ${theme})`, async ({
        page,
      }, testInfo) => {
        await preferences(page, { theme, locale: 'en' });
        await open(page, slots);
        await expect(page.locator('[data-slot=template-review][data-variant=page]')).toBeVisible();
        await expect(count(page)).toContainText(toCheck);
        await expectAccessible(page, testInfo, `slots page (${shape}, ${theme})`);
        await screenshotWhole(page, shot(`slots-page-${shape}-${theme}`));
        // At 960 × 600 the page needs no scroll of its own: the panel's is the one scroll, and the count is in view.
        await page.setViewportSize({ width: 960, height: 600 });
        const scroller = page.locator('[data-slot=scroll-area]').first();
        await expect
          .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
          .toBeLessThanOrEqual(1);
        await expect(count(page)).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: new URL(shot(`slots-page-${shape}-960-${theme}`)).pathname });
      });

  for (const { shape, chat, slots } of SHAPES)
    for (const locale of ['hi', 'en-XA'] as const)
      test(`the card, the sheet and the page in ${locale} (${shape})`, async ({ page }) => {
        await preferences(page, { theme: 'light', locale });
        await page.setViewportSize({ width: 960, height: 600 });
        await open(page, chat);
        await expect(card(page).locator('[data-slot=breakdown-summary]')).toBeVisible({ timeout: 15_000 });
        if (locale === 'en-XA') await expectPseudoClean(page, `breakdown card (${shape})`);
        await card(page).screenshot({ path: new URL(shot(`card-${shape}-light-${locale}`)).pathname });
        await card(page).locator('[data-slot=breakdown-summary] button').first().click();
        await expect(sheet(page)).toBeVisible();
        if (locale === 'en-XA') await expectPseudoClean(page, `review sheet (${shape})`);
        await page.screenshot({ path: new URL(shot(`sheet-${shape}-960-light-${locale}`)).pathname });
        await page.setViewportSize({ width: 1280, height: 800 });
        await open(page, slots);
        await expect(page.locator('[data-slot=template-review][data-variant=page]')).toBeVisible();
        if (locale === 'en-XA') await expectPseudoClean(page, `slots page (${shape})`);
        await screenshotWhole(page, shot(`slots-page-${shape}-light-${locale}`));
      });
});
