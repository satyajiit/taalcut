// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1 (phoneweb): how the phone upload page behaves, on the Galaxy S26 Ultra's 412 px. The PIN boxes (typing,
// Backspace, paste, the keyboard's one-time code, errors without a shake), the routes (Back, Forward, unknown
// and guarded steps, a reload), the row actions (pause, resume, stop, send again, try again), the fonts and
// the motion. phone-page.spec.ts photographs the screens; phone-page-support.ts serves the page and its Mac.
import { expect, test, type Page } from '@playwright/test';
import {
  BUSY_PIN,
  GALAXY_S26 as PHONE,
  GOOD_PIN,
  openPhone,
  ORIGIN,
  pairPhone,
  pick,
  QR_TOKEN,
  row,
  rows,
  SENDING,
  SETUP_CODE,
  typePin,
  usePin,
} from './phone-page-support.ts';

test.describe.configure({ timeout: 120_000 });

const digit = (page: Page, n: number) => page.getByRole('textbox', { name: `Digit ${n} of 6` });
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
const values = (page: Page) => page.locator('#pin .digit').evaluateAll((boxes) => boxes.map((box) => (box as HTMLInputElement).value).join(''));
const route = (page: Page) => page.evaluate(() => location.hash);

test.describe('the PIN boxes', () => {
  test('one named group of six numeric boxes that the keyboard can fill from a text message', async ({ browser }) => {
    const { page, close } = await openPhone(browser, PHONE, { theme: 'light' });
    const group = page.getByRole('group', { name: 'PIN' });
    await expect(group.getByRole('textbox')).toHaveCount(6);
    for (let n = 1; n <= 6; n += 1) {
      await expect(digit(page, n)).toHaveAttribute('inputmode', 'numeric');
      await expect(digit(page, n)).toHaveAttribute('autocomplete', 'one-time-code');
    }
    expect(await focused(page), 'the first box waits for the PIN').toBe('Digit 1 of 6');
    expect(await group.evaluate((el) => getComputedStyle(el).borderTopStyle), 'no frame around the boxes').toBe('none');
    const box = await digit(page, 1).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(56);
    // The keyboard's suggestion lands the whole code in the first box.
    await digit(page, 1).fill(GOOD_PIN);
    await expect(page.locator('#screen-choose')).toBeVisible();
    await close();
  });

  test('two groups of three, as the Mac shows "482 913", at the narrowest phone and the S26', async ({ browser }) => {
    for (const width of [320, PHONE.width]) {
      const { page, close } = await openPhone(browser, { ...PHONE, width }, { theme: 'light' });
      const boxes = await page.locator('#pin .digit').evaluateAll((all) => all.map((box) => box.getBoundingClientRect()));
      const gaps = boxes.slice(1).map((box, index) => Math.round(box.left - (boxes[index]?.right ?? 0)));
      const inner = [gaps[0], gaps[1], gaps[3], gaps[4]];
      expect(new Set(inner).size, `${width}: even gaps inside each half`).toBe(1);
      expect(gaps[2], `${width}: the halves part`).toBeGreaterThanOrEqual(2 * (inner[0] ?? 0));
      expect(Math.min(...boxes.map((box) => box.width)), `${width}: 44 px boxes`).toBeGreaterThanOrEqual(44);
      const face = await page.locator('#pin .digit').first().evaluate((box) => getComputedStyle(box).fontFamily);
      expect(face, 'the Mac sets the PIN in JetBrains Mono').toMatch(/^"JetBrains Mono Variable"/);
      await close();
    }
  });

  test('the setup code is taken as the Mac shows it, with or without the space, in any case', async ({ browser }) => {
    for (const typed of ['7kd2 m9qx', '7KD2M9QX', '7KD2-M9QX', ' 7kd2 M9qx ']) {
      const { page, mac, close } = await openPhone(browser, PHONE, { theme: 'light', token: false });
      await expect(page.locator('label[for=code]')).toHaveText('Setup code');
      await page.locator('#code').fill(typed);
      await pairPhone(page);
      expect(mac.code, typed).toBe(SETUP_CODE);
      await close();
    }
  });

  test('typing moves on, Backspace moves back, the arrows move, letters are ignored', async ({ browser }) => {
    const { page, close } = await openPhone(browser, PHONE, { theme: 'light' });
    await typePin(page, '4a8');
    expect(await values(page)).toBe('48');
    expect(await focused(page)).toBe('Digit 3 of 6');
    await page.keyboard.press('Backspace');
    expect(await values(page)).toBe('4');
    expect(await focused(page), 'Backspace on an empty box clears the one before and moves to it').toBe('Digit 2 of 6');
    await page.keyboard.type('72');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await focused(page)).toBe('Digit 2 of 6');
    await page.keyboard.type('8');
    expect(await values(page), 'typing over a box replaces its digit').toBe('482');
    await page.keyboard.press('End');
    expect(await focused(page)).toBe('Digit 6 of 6');
    await close();
  });

  test('a paste fills every box from wherever it lands and connects', async ({ browser }) => {
    const { page, mac, close } = await openPhone(browser, PHONE, { theme: 'light' });
    await digit(page, 4).evaluate((box, text) => {
      const data = new DataTransfer();
      data.setData('text', text);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, '482 913');
    await expect(page.locator('#pin')).toHaveAttribute('data-state', 'success');
    await expect(page.locator('#pair-submit')).toHaveText('Connected');
    await expect(page.locator('#screen-choose')).toBeVisible();
    expect(mac.pairs).toBe(1);
    await close();
  });

  test('a wrong PIN marks the boxes without moving them; too many tries holds Connect', async ({ browser }) => {
    const { page, mac, close } = await openPhone(browser, PHONE, { theme: 'light' });
    await page.locator('#pair-submit').click();
    await expect(page.locator('#pair-error-text')).toHaveText('Type all six digits of the PIN.');
    await typePin(page, '111111');
    await expect(page.locator('#pin')).toHaveAttribute('data-state', 'error');
    await expect(digit(page, 3)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#pin')).toHaveAttribute('aria-describedby', 'pair-error-text');
    // Colours may fade into the error state; nothing may move.
    const moving = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest('#pair-form'))
        .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes())
        .filter((frame) => ['transform', 'translate', 'left', 'marginLeft', 'rotate'].some((key) => key in frame)),
    );
    expect(moving, 'no shake, no bounce').toEqual([]);
    expect(await focused(page), 'back to the first box to type it again').toBe('Digit 1 of 6');
    // Correcting a digit clears the error and waits for Connect; typing the whole PIN again sends it.
    await page.keyboard.type('2');
    await expect(page.locator('#pair-error')).toBeHidden();
    await expect(page.locator('#pin')).toHaveAttribute('data-state', 'idle');
    expect(mac.pairs).toBe(1);
    await page.keyboard.type('22222');
    await expect(page.locator('#pair-error-text')).toHaveText('Too many tries. Wait a moment, then try again.');
    await expect(page.locator('#pair-submit')).toBeDisabled();
    await expect(page.locator('#pair-submit')).toBeEnabled({ timeout: 3_000 });
    expect(BUSY_PIN).toBe('222222');
    await close();
  });
});

test.describe('routes', () => {
  test('a step you may not see yet sends you to the one you may', async ({ browser }) => {
    const { page, close } = await openPhone(browser, PHONE, { theme: 'light' });
    expect(await route(page)).toBe('#/pair');
    await page.evaluate(() => {
      location.hash = '#/done';
    });
    await expect.poll(() => route(page)).toBe('#/pair');
    await pairPhone(page);
    expect(await route(page)).toBe('#/choose');
    for (const asked of ['#/done', '#/sending', '#/pair', '#/nowhere']) {
      await page.evaluate((hash) => {
        location.hash = hash;
      }, asked);
      await expect.poll(() => route(page), asked).toBe('#/choose');
    }
    await close();
  });

  test('Back and Forward walk the steps, and coming back to choose more never piles up history', async ({ browser }) => {
    const { page, close } = await openPhone(browser, PHONE, { theme: 'light' });
    await pairPhone(page);
    await pick(page, PHONE, SENDING);
    await expect(page.locator('#screen-sending')).toBeVisible();
    expect(await route(page)).toBe('#/sending');
    const depth = await page.evaluate(() => history.length);
    await page.goBack();
    await expect(page.locator('#screen-choose')).toBeVisible();
    await expect(page.locator('#choose-strip-text')).toHaveText('2 on the way');
    await page.goForward();
    await expect(page.locator('#screen-sending')).toBeVisible();
    await page.locator('#send-more').click();
    await expect(page.locator('#screen-choose')).toBeVisible();
    await page.locator('#choose-strip-link').click();
    await expect(page.locator('#screen-sending')).toBeVisible();
    await expect(page.locator('#sending-title')).toBeFocused();
    expect(await page.evaluate(() => history.length)).toBe(depth);
    await expect(page).toHaveTitle('Sending to your Mac · Taalcut');
    await close();
  });

  test('a reload keeps the connection, the step and the rows; choosing a file again finishes it', async ({ browser }) => {
    const { page, mac, close } = await openPhone(browser, PHONE, { theme: 'light' });
    await pairPhone(page);
    await pick(page, PHONE, SENDING);
    await expect(row(page, 'golden').locator('.row-meter')).toContainText('42%');
    await page.reload();
    await expect(page.locator('#screen-sending')).toBeVisible();
    await expect(rows(page)).toHaveCount(SENDING.length);
    await expect(row(page, 'IMG_0412').locator('.row-state')).toHaveText('Added');
    await expect(row(page, 'golden').locator('.row-state')).toHaveText('Not sent yet');
    await expect(row(page, 'golden').locator('.row-reason')).toHaveText(
      'This page was reloaded. Choose this video again to finish sending it.',
    );
    await expect(page.locator('#lockup')).not.toHaveAttribute('data-intro', /.*/);
    await page.locator('#send-more').click();
    await pick(page, PHONE, SENDING.slice(3, 4));
    await expect(row(page, 'golden').locator('.row-state')).toHaveText('Sending');
    expect(mac.resumed, 'the upload carried on from the bytes the Mac has').toHaveLength(1);
    await expect(rows(page)).toHaveCount(SENDING.length);
    await close();
  });

  test('a reload before connecting keeps the QR code’s token', async ({ browser }) => {
    const { page, mac, close } = await openPhone(browser, PHONE, { theme: 'light' });
    await page.goto(`${ORIGIN}/`);
    await page.reload();
    await expect(page.locator('#screen-pair')).toBeVisible();
    // It asks the computer again with the token, and the PIN still needs no setup code.
    await expect(page.locator('#approval-code')).toBeVisible();
    expect(mac.approval.asks.at(-1)?.token).toBe(QR_TOKEN);
    await usePin(page);
    await expect(page.locator('#code-field')).toBeHidden();
    await pairPhone(page);
    await close();
  });
});

test.describe('rows', () => {
  test('pause keeps the bytes, resume carries on, stop deletes them, send again starts over', async ({ browser }) => {
    const { page, mac, close } = await openPhone(browser, PHONE, { theme: 'light' });
    await pairPhone(page);
    await pick(page, PHONE, SENDING.slice(3));
    const golden = row(page, 'golden');
    await expect(golden.locator('.row-meter')).toContainText('42%');
    await golden.getByRole('button', { name: 'Pause golden-hour-b-roll.mp4' }).click();
    await expect(golden.locator('.row-state')).toHaveText('Paused');
    await expect(golden.getByRole('button', { name: 'Resume golden-hour-b-roll.mp4' })).toBeFocused();
    await expect(row(page, 'chai').locator('.row-state')).toHaveText('Added', { timeout: 10_000 });
    expect(mac.terminated).toEqual([]);

    await golden.getByRole('button', { name: 'Resume golden-hour-b-roll.mp4' }).click();
    await expect(golden.locator('.row-state')).toHaveText('Sending');
    expect(mac.resumed).toHaveLength(1);

    // Stopping the last file on its way settles the visit: the done step shows it, with Send again.
    await golden.getByRole('button', { name: 'Stop sending golden-hour-b-roll.mp4' }).click();
    await expect(page.locator('#screen-done')).toBeVisible();
    await expect(row(page, 'golden', '#done-missing').locator('.row-state')).toHaveText('Stopped');
    await expect.poll(() => mac.terminated).toHaveLength(1);
    await row(page, 'golden', '#done-missing').getByRole('button', { name: 'Send again' }).click();
    await expect(page.locator('#screen-sending')).toBeVisible();
    await expect(golden.locator('.row-state')).toHaveText('Sending');
    await close();
  });

  test('a refusal that may pass offers Try again; a file the Mac can never take does not', async ({ browser }) => {
    const { page, close } = await openPhone(browser, PHONE, { theme: 'light' });
    await pairPhone(page);
    await pick(page, PHONE, [
      { name: 'flaky-take.mov', size: 900_000 },
      { name: 'market-walk-4k.mov', size: 3_100_000 },
    ]);
    await expect(page.locator('#screen-done')).toBeVisible({ timeout: 10_000 });
    const flaky = row(page, 'flaky', '#done-missing');
    await expect(flaky.locator('.row-reason')).toHaveText('Your Mac turned this video away. Try again in a moment.');
    await expect(row(page, 'market', '#done-missing').getByRole('button')).toHaveCount(0);
    await flaky.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#done-title')).toHaveText('1 of 2 on your Mac', { timeout: 10_000 });
    await close();
  });
});

test.describe('fonts and motion', () => {
  test('Onest and JetBrains Mono come from the Mac, and nothing else is fetched', async ({ browser }) => {
    const { page, close } = await openPhone(browser, PHONE, { theme: 'light' });
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    await pairPhone(page);
    await pick(page, PHONE, SENDING);
    await expect(row(page, 'golden').locator('.row-meter')).toContainText('/s');
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        loaded: [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replaceAll('"', '')),
        body: getComputedStyle(document.body).fontFamily,
        meter: getComputedStyle(document.querySelector('.row-meter') as Element).fontFamily,
      };
    });
    expect(fonts.loaded).toEqual(expect.arrayContaining(['Onest Variable', 'JetBrains Mono Variable']));
    expect(fonts.body).toMatch(/^"Onest Variable"/);
    expect(fonts.meter).toMatch(/^"JetBrains Mono Variable"/);
    expect(requested.filter((url) => !url.startsWith(ORIGIN))).toEqual([]);
    await close();
  });

  test('the logo counts itself in once a visit', async ({ browser }) => {
    const { page, close } = await openPhone(browser, PHONE, { theme: 'light' });
    await expect(page.locator('#lockup')).toHaveAttribute('data-intro', '');
    const names = await page.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName));
    expect(names).toEqual(expect.arrayContaining(['arc-fade', 'arc-drop', 'word-slide']));
    await page.reload();
    await expect(page.locator('#lockup')).not.toHaveAttribute('data-intro', /.*/);
    await close();
  });

  test('reduced motion: one 150 ms fade, bars that step; forced colours keep the focus ring and the bars', async ({ browser }) => {
    const { page, close } = await openPhone(browser, PHONE, {
      theme: 'light',
      reducedMotion: 'reduce',
      forcedColors: 'active',
    });
    const intro = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a instanceof CSSAnimation)
        .map((a) => [(a as CSSAnimation).animationName, a.effect?.getTiming().duration]),
    );
    expect(intro).toEqual([['fade', 150]]);
    expect(await digit(page, 1).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await pairPhone(page);
    await pick(page, PHONE, SENDING);
    const golden = row(page, 'golden');
    await expect(golden.locator('.row-meter')).toContainText('42%');
    const motion = await golden.evaluate((el) => ({
      bar: getComputedStyle(el.querySelector('.bar') as Element).outlineStyle,
      transition: getComputedStyle(el.querySelector('.bar') as Element, '::before').transitionProperty,
    }));
    expect(motion.bar).toBe('solid');
    expect(motion.transition, 'the bar steps: only colours fade').not.toContain('transform');
    await close();
  });

  test('the real tus-js-client loads under the page CSP', async ({ browser }) => {
    const { page, problems, close } = await openPhone(browser, PHONE, { theme: 'light', tus: 'real' });
    expect(await page.evaluate(() => typeof (window as { tus?: { Upload?: unknown } }).tus?.Upload)).toBe('function');
    expect(problems).toEqual([]);
    await close();
  });
});
