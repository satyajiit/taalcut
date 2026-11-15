// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// FIX-DOCKCHAT: the editor's chat is a narrow column (the dock is 320, 360 or 400 px wide; a card gets that less the
// dock's padding), and every chat card has to lay out in it. The cast board first, the one that broke there: each
// slot's sentence was squeezed to a word a line under its other shots. Then every other card the chat can show.
// Against two opt-in fixtures of the fakes (`reelRun`, src/backend/fake/options/reel-run.ts): a project whose chat
// holds a real run's cards (32 slots with the breakdown's sentences, the cast as that run left it), and the same
// project with every card fixture in its chat.
import { expect, test, type Page } from '@playwright/test';
import { FAKE_OPTIONS_KEY, preferences } from './support.ts';

/** The reel run's project (src/backend/fake/make/p3/seeds/reel-run.ts REEL_RUN_PROJECT). */
const PROJECT = '01K7C5M6Q8M000000000000026';
const EDITOR = `/projects/${PROJECT}/timeline`;
/** src/features/timeline/dock/dock-memory.ts DOCK_STORAGE_KEY: the dock on Chat, whatever the window's width. */
const DOCK_STORAGE_KEY = 'taalcut.editorDock';
/** The window widths at which the dock takes each of its three widths (dock/editor-dock.tsx). */
const DOCKS = [
  { width: 1100, dock: 320 },
  { width: 1280, dock: 360 },
  { width: 1440, dock: 400 },
] as const;
const NARROWEST = DOCKS[0];
const TRANSCRIPT = '[data-slot=editor-dock] [data-slot=transcript]';

type Locale = 'en' | 'hi' | 'es' | 'pt-BR' | 'en-XA';

/**
 * Opens the reel run's editor with the dock on Chat (the run's own chat, or the one with every card) and waits for
 * the chat to hold still. Not support.ts's open(): the chat with every card shows the cards' loading states too,
 * which that waits out.
 */
async function openDock(
  page: Page,
  { width, dock }: (typeof DOCKS)[number],
  chat: true | 'everyCard',
  locale: Locale = 'en',
) {
  await page.setViewportSize({ width, height: 900 });
  await preferences(page, { locale, theme: 'light' });
  await page.addInitScript(
    ({ fakeKey, dockKey, project, chat }) => {
      window.localStorage.setItem(
        fakeKey,
        JSON.stringify({ speed: 0, latencyMs: 0, renderTickMs: 0, indexingTickMs: 0, reelRun: chat }),
      );
      window.localStorage.setItem(dockKey, JSON.stringify({ [project]: 'chat' }));
    },
    { fakeKey: FAKE_OPTIONS_KEY, dockKey: DOCK_STORAGE_KEY, project: PROJECT, chat },
  );
  await page.goto(EDITOR);
  // A chat of a hundred and fifty cards takes a moment to draw.
  await expect(page.locator(`${TRANSCRIPT} > li`).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-slot=editor-dock]')).toHaveJSProperty('offsetWidth', dock);
  if (chat === 'everyCard')
    await expect.poll(() => page.locator(`${TRANSCRIPT} > li`).count()).toBeGreaterThan(100);
  else {
    // The board folds to its first slots and the unsure ones: open it, so all 32 rows are checked.
    const board = page.locator(`${TRANSCRIPT} [data-card-type=castBoard]`);
    await board.locator('[role=grid] + button').click();
    await expect(board.locator('[role=row]')).toHaveCount(32);
  }
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/**
 * Runs in the page: what is wrong with the cards in a chat column. Nothing sticks out of its row (but inside a box
 * that scrolls or clips on purpose), nothing makes the column scroll sideways, no sentence is squeezed to a word a
 * line, and words cut with an ellipsis or a line clamp keep their whole in a tooltip.
 */
function columnProblems(scope: string): string[] {
  const column = document.querySelector<HTMLElement>(scope);
  if (!column) return [`nothing matches ${scope}`];
  const problems = new Set<string>();
  const say = (el: Element) => {
    const card = el.closest('[data-card-type]')?.getAttribute('data-card-type') ?? 'card';
    const words = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');
    return `${card} <${el.tagName.toLowerCase()}> "${words.slice(0, 40)}"`;
  };
  for (let el: HTMLElement | null = column; el; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1)
      problems.add(
        `scrolls sideways: ${el.dataset.slot ?? el.tagName} (${el.scrollWidth} in ${el.clientWidth})`,
      );
    if (el.dataset.slot === 'editor-dock') break;
  }
  const rows = [...column.querySelectorAll<HTMLElement>(':scope > li')];
  if (rows.length === 0) problems.add('no rows in the chat');
  for (const row of rows) {
    const bound = row.getBoundingClientRect();
    /** Inside a box (in this row) that scrolls or clips sideways on purpose. */
    const clipped = (el: Element) => {
      for (let box = el.parentElement; box && box !== row.parentElement; box = box.parentElement)
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(box).overflowX)) return true;
      return false;
    };
    for (const el of row.querySelectorAll<HTMLElement>('[data-slot=smart-card], [data-slot=smart-card] *')) {
      if (el.closest('.sr-only') || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
        continue;
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      const style = getComputedStyle(el);
      const past = Math.max(box.right - bound.right, bound.left - box.left);
      // A turning spinner's box is wider than the spinner at most angles: its own animation, not the layout.
      const turning = el.getAnimations().length > 0;
      if (past > 1 && !turning && !clipped(el))
        problems.add(`${Math.round(past)}px past the column: ${say(el)}`);
      const own = [...el.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? '')
        .join(' ')
        .trim();
      if (own.length > 24 && box.width < parseFloat(style.fontSize) * 6 && style.whiteSpace !== 'nowrap')
        problems.add(`squeezed to ${Math.round(box.width)}px: ${say(el)}`);
      const cutAcross = style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      const cutDown =
        style.getPropertyValue('-webkit-line-clamp') !== 'none' && el.scrollHeight > el.clientHeight + 1;
      // The whole is to hand when the cut box, something round it, or the words inside it carry a tooltip.
      if ((cutAcross || cutDown) && !el.closest('[title]') && !el.querySelector('[title]'))
        problems.add(`cut off with no tooltip: ${say(el)}`);
    }
  }
  return [...problems];
}

/**
 * Runs in the page: what is wrong with the cast board's rows. A row holds its number, the pick, the slot's sentence
 * and, under or beside it, the other shots with Find something else and Lock: none of them on top of another,
 * all inside the row, the sentence with room to read, the frames at their 9:16, the buttons big enough to hit.
 */
function boardProblems(scope: string): string[] {
  const grid = document.querySelector<HTMLElement>(`${scope} [data-card-type=castBoard] [role=grid]`);
  if (!grid) return ['no cast board in the chat'];
  const problems: string[] = [];
  const rows = [...grid.querySelectorAll<HTMLElement>('[role=row]')];
  if (rows.length === 0) problems.push('the board has no rows');
  const crossing = (a: DOMRect, b: DOMRect) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  for (const row of rows) {
    const n = row.getAttribute('aria-rowindex') ?? '?';
    const box = row.getBoundingClientRect();
    const words = row.querySelectorAll<HTMLElement>('[role=gridcell]')[1];
    const strip = row.querySelector<HTMLElement>('[data-slot=alternates]');
    if (!words || !strip) {
      problems.push(`slot ${n}: no words or no other shots`);
      continue;
    }
    if (row.scrollWidth > row.clientWidth + 1) problems.push(`slot ${n}: wider than the board`);
    const wordsBox = words.getBoundingClientRect();
    if (wordsBox.width < 128) problems.push(`slot ${n}: the sentence has ${Math.round(wordsBox.width)}px`);
    const parts: [string, DOMRect][] = [['words', wordsBox]];
    const add = (name: string, el: Element | null) => {
      if (el) parts.push([name, el.getBoundingClientRect()]);
    };
    add('pick', row.querySelector('[data-col=pick]'));
    add('find', row.querySelector('[data-col=find]'));
    add('lock', row.querySelector('[data-col=lock]'));
    // The other shots as far as the strip shows them (it may scroll inside its own box).
    const view = strip.getBoundingClientRect();
    strip.querySelectorAll<HTMLElement>('[data-alternate]').forEach((el, index) => {
      const shot = el.getBoundingClientRect();
      const left = Math.max(shot.left, view.left);
      const right = Math.min(shot.right, view.right);
      if (right - left > 1)
        parts.push([`other shot ${index + 1}`, new DOMRect(left, shot.top, right - left, shot.height)]);
    });
    for (const [name, part] of parts) {
      if (
        part.left < box.left - 1 ||
        part.right > box.right + 1 ||
        part.top < box.top - 1 ||
        part.bottom > box.bottom + 1
      )
        problems.push(`slot ${n}: ${name} is outside its row`);
    }
    parts.forEach(([a, first], i) => {
      for (const [b, second] of parts.slice(i + 1))
        if (crossing(first, second)) problems.push(`slot ${n}: ${a} and ${b} overlap`);
    });
    for (const thumb of row.querySelectorAll<HTMLElement>('[data-slot=shot-thumb]')) {
      const frame = thumb.getBoundingClientRect();
      if (frame.width < 36 || Math.abs(frame.width / frame.height - 9 / 16) > 0.03)
        problems.push(
          `slot ${n}: a frame is ${Math.round(frame.width)}x${Math.round(frame.height)}, not 9:16`,
        );
    }
    for (const control of row.querySelectorAll<HTMLElement>('[data-col=find], [data-col=lock]')) {
      const target = control.getBoundingClientRect();
      if (target.width < 24 || target.height < 24)
        problems.push(`slot ${n}: ${control.dataset.col} is ${Math.round(target.width)}px to hit`);
    }
  }
  return problems;
}

test.describe('chat cards in the editor’s chat column (FIX-DOCKCHAT)', () => {
  for (const size of DOCKS) {
    test(`the cast board lays out in a ${size.dock}px dock`, async ({ page }) => {
      await openDock(page, size, true);
      await expect.poll(() => page.evaluate(boardProblems, TRANSCRIPT)).toEqual([]);
      await expect.poll(() => page.evaluate(columnProblems, TRANSCRIPT)).toEqual([]);
    });

    test(`every card stays inside a ${size.dock}px dock`, async ({ page }) => {
      await openDock(page, size, 'everyCard');
      await expect.poll(() => page.evaluate(columnProblems, TRANSCRIPT)).toEqual([]);
    });
  }

  // Longer words: the pseudo-locale adds a third to every string, and the app's other languages run long too.
  for (const locale of ['en-XA', 'es', 'pt-BR', 'hi'] as const) {
    test(`every card stays inside the narrowest dock in ${locale}`, async ({ page }) => {
      await openDock(page, NARROWEST, 'everyCard', locale);
      await expect.poll(() => page.evaluate(columnProblems, TRANSCRIPT)).toEqual([]);
    });
  }

  test('the cast board lays out in the narrowest dock with longer words', async ({ page }) => {
    await openDock(page, NARROWEST, true, 'en-XA');
    await expect.poll(() => page.evaluate(boardProblems, TRANSCRIPT)).toEqual([]);
    await expect.poll(() => page.evaluate(columnProblems, TRANSCRIPT)).toEqual([]);
  });

  test('with no room for every other shot, the strip scrolls inside its row', async ({ page }) => {
    await openDock(page, NARROWEST, true);
    const grid = page.locator(`${TRANSCRIPT} [data-card-type=castBoard] [role=grid]`);
    const row = grid.locator('[role=row]').first();
    const strip = row.locator('[data-slot=alternates]');
    const shots = strip.locator('[data-alternate]');
    await expect(shots).toHaveCount(3);
    // In the dock a slot's three other shots fit. Narrower than any dock (a width set from here, as a narrower
    // column would give it), they no longer do: the strip scrolls, the frames keep their size, the row holds.
    const frame = await shots.first().evaluate((el) => el.getBoundingClientRect().width);
    await grid.evaluate((el) => {
      (el as HTMLElement).style.width = '252px';
    });
    await expect.poll(() => strip.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(8);
    expect(await shots.first().evaluate((el) => el.getBoundingClientRect().width)).toBe(frame);
    expect(await row.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(boardProblems, TRANSCRIPT)).toEqual([]);
    // Keyboard reach: focus on the last shot brings it into the strip's box.
    await shots.last().focus();
    await expect
      .poll(() =>
        strip.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const last = [...el.querySelectorAll('[data-alternate]')].at(-1)?.getBoundingClientRect();
          return last ? Math.round(Math.max(last.right - box.right, box.left - last.left)) : 999;
        }),
      )
      .toBeLessThanOrEqual(0);
  });
});
