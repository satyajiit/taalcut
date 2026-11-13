// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pseudo-locale checks (nothing English, nothing clipped) on one region of the page: a dialog, or a page's own
 * content. The templates and hub specs use it so their en-XA checks cover what those pages draw; the sidebar and the
 * window bar have their own checks in the shell's specs.
 */
import { expect, type Page } from '@playwright/test';
import { clippedText, englishPhrases, englishShowing, untranslated, type Finding } from './inspect.ts';

const phrases = englishPhrases();

/** Visible text and user-facing attributes inside `root`, as inspect.ts's userFacingText reads the whole page. */
async function textWithin(page: Page, root: string): Promise<Finding[]> {
  return page.evaluate((selector) => {
    const found: { text: string; where: string }[] = [];
    const skip = (el: Element) => el.closest('[translate="no"], time, [data-user-content]') !== null;
    // A person's own words used as a name (a folder's list is labelled by the folder's name, as the rail shows it).
    const ownWords = new Set(
      [...document.querySelectorAll('[data-user-content]')].map((el) =>
        el.textContent?.replace(/~/g, '').trim(),
      ),
    );
    for (const region of document.querySelectorAll(selector)) {
      const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const value = walker.currentNode.textContent?.trim();
        const el = walker.currentNode.parentElement;
        if (value && el && el.checkVisibility() && !skip(el)) found.push({ text: value, where: el.tagName });
      }
      for (const el of region.querySelectorAll('[aria-label], [placeholder], [title], [alt]'))
        for (const name of ['aria-label', 'placeholder', 'title', 'alt']) {
          const value = el.getAttribute(name)?.trim();
          // A tooltip that repeats the box's own text (a cut line's whole) was read with that text.
          const repeats = name === 'title' && value === el.textContent?.trim();
          if (value && !skip(el) && !repeats && !(name === 'aria-label' && ownWords.has(value)))
            found.push({ text: value, where: `${el.tagName} @${name}` });
        }
    }
    return found;
  }, root);
}

/** Nothing English and nothing clipped inside `root` (a CSS selector). */
export async function expectPseudoCleanWithin(page: Page, root: string, label: string): Promise<void> {
  const text = await textWithin(page, root);
  expect(text.length, `${label}: nothing found inside ${root}`).toBeGreaterThan(0);
  expect(englishShowing(text, phrases), `${label}: English source strings on screen`).toEqual([]);
  expect(untranslated(text), `${label}: strings that skipped the catalogue`).toEqual([]);
  expect(await clippedText(page, `${root}, ${root} *`), `${label}: text that does not fit`).toEqual([]);
}
