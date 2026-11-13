// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

export interface Finding {
  text: string;
  where: string;
}

/**
 * Every string a person can see or hear on the page: visible text (including
 * screen-reader-only text), the user-facing attributes (aria-label,
 * placeholder, title, alt) and the window title.
 *
 * Left out, because the catalogue can't and shouldn't translate them: text
 * inside [data-user-content] (messages, titles, model output); anything inside
 * translate="no" (names and data: model ids, product names); and the text of
 * <time> elements, which Intl formats (the pseudo-locale has no Intl data, so
 * dates stay English).
 *
 * `within` narrows it to the first element matching that selector (one card
 * among others'), without the window title.
 */
export async function userFacingText(page: Page, within?: string): Promise<Finding[]> {
  return page.evaluate((selector) => {
    const root = selector === undefined ? document.body : document.querySelector(selector);
    if (!root) throw new Error(`nothing matches ${selector ?? 'body'}`);
    const describe = (el: Element): string => {
      const parts: string[] = [];
      for (
        let node: Element | null = el;
        node && node !== document.body && parts.length < 4;
        node = node.parentElement
      ) {
        const slot = node.getAttribute('data-slot');
        parts.unshift(node.tagName.toLowerCase() + (slot ? `[${slot}]` : ''));
      }
      return parts.join(' > ');
    };
    const found: { text: string; where: string }[] = [];
    const notCatalogue = (el: Element) => el.closest('[translate="no"], time') !== null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (!text || !el || !el.checkVisibility({ visibilityProperty: true, opacityProperty: false })) continue;
      // What the user or the model wrote is data, shown as written: never translated.
      if (notCatalogue(el) || el.closest('[data-user-content]')) continue;
      found.push({ text, where: describe(el) });
    }
    for (const el of root.querySelectorAll('[aria-label], [placeholder], [title], [alt]')) {
      if (!el.checkVisibility({ visibilityProperty: true }) || notCatalogue(el)) continue;
      for (const name of ['aria-label', 'placeholder', 'title', 'alt']) {
        const value = el.getAttribute(name)?.trim();
        if (value) found.push({ text: value, where: `${describe(el)} @${name}` });
      }
    }
    if (selector === undefined) found.push({ text: document.title, where: 'document.title' });
    return found;
  }, within);
}

/** A number with its unit is Intl's (CLDR data), never a catalogue string: "14.3 sec", "2 min", "28 MB". */
const INTL_UNIT = /\d[\d.,]*\s?(?:ms|sec|min|hr|byte|kB|MB|GB|TB)\b/g;

/**
 * Strings that can't be pseudo-localised. Lingui's pseudo-locale accents every
 * letter except v and x, so three plain ASCII letters in a row mean the text
 * never went through the catalogue.
 */
export function untranslated(found: readonly Finding[]): Finding[] {
  return found.filter((f) => /[A-Za-z]{3,}/.test(f.text.replace(INTL_UNIT, '')));
}

/** Phrases from the English source catalogue, for a direct "English is showing" check. */
export function englishPhrases(): string[] {
  const po = readFileSync(new URL('../src/locales/en/messages.po', import.meta.url), 'utf8');
  const phrases = new Set<string>();
  for (const match of po.matchAll(/^msgid "(.+)"$/gm)) {
    const message = (match[1] ?? '').replace(/\\"/g, '"');
    // Split around ICU placeholders and rich-text tags; keep the plain-English runs.
    for (const run of message.split(/\{[^}]*\}|<\/?\d+>|<\d+\/>/)) {
      const phrase = run.trim();
      if (/[A-Za-z]{3,}/.test(phrase)) phrases.add(phrase);
    }
  }
  return [...phrases];
}

interface CatalogueEntry {
  key: string;
  english: string;
  translation: string;
}

/** A catalogue's messages by context and id (Lingui writes each field on one line). */
function readCatalogue(locale: string): Map<string, { id: string; msgstr: string; explicit: boolean }> {
  const po = readFileSync(new URL(`../src/locales/${locale}/messages.po`, import.meta.url), 'utf8');
  const entries = new Map<string, { id: string; msgstr: string; explicit: boolean }>();
  const field = (block: string, name: string) => {
    const line = block.split('\n').find((each) => each.startsWith(`${name} "`));
    return line === undefined ? undefined : (JSON.parse(line.slice(name.length + 1)) as string);
  };
  for (const block of po.split('\n\n')) {
    const id = field(block, 'msgid');
    if (!id) continue;
    const context = field(block, 'msgctxt') ?? '';
    entries.set(`${context}\u0004${id}`, {
      id,
      msgstr: field(block, 'msgstr') ?? '',
      explicit: block.includes('#. js-lingui-explicit-id'),
    });
  }
  return entries;
}

/**
 * English phrases a language has its own words for: runs of two or more words from every message whose
 * translation differs from the English and doesn't contain that run itself (a brand name, a product's own label).
 * Seeing one on a page in that language means English leaked past the catalogue.
 */
export function translatedPhrases(locale: string): string[] {
  const english = readCatalogue('en');
  const translated = readCatalogue(locale);
  const entries: CatalogueEntry[] = [];
  for (const [key, source] of english) {
    const target = translated.get(key);
    const text = source.explicit ? source.msgstr : source.id;
    if (target && target.msgstr !== '' && target.msgstr !== text)
      entries.push({ key, english: text, translation: target.msgstr });
  }
  const phrases = new Set<string>();
  for (const entry of entries) {
    for (const run of entry.english.split(/\{[^}]*\}|<\/?\d+>|<\d+\/>|[“”"‘’]/)) {
      const phrase = run.trim();
      if (
        phrase.split(/\s+/).length >= 2 &&
        /[A-Za-z]{3,}/.test(phrase) &&
        !entry.translation.includes(phrase)
      )
        phrases.add(phrase);
    }
  }
  return [...phrases];
}

/** A language's own phrases (runs of two or more words its translations don't share with the English). */
export function localePhrases(locale: string): string[] {
  const english = readCatalogue('en');
  const phrases = new Set<string>();
  for (const [key, target] of readCatalogue(locale)) {
    const source = english.get(key);
    if (!source || target.msgstr === '') continue;
    const text = source.explicit ? source.msgstr : source.id;
    for (const run of target.msgstr.split(/\{[^}]*\}|<\/?\d+>|<\d+\/>|[“”"‘’«»]/)) {
      const phrase = run.trim();
      if (phrase.split(/\s+/).length >= 2 && !text.includes(phrase)) phrases.add(phrase);
    }
  }
  return [...phrases];
}

const WORD = /[\p{L}\p{M}\p{N}]/u;

/** The phrase as whole words: "s videos" (from "Taalcut’s videos") isn't in "Tus videos". */
function showsPhrase(text: string, phrase: string): boolean {
  for (let at = text.indexOf(phrase); at >= 0; at = text.indexOf(phrase, at + 1)) {
    const before = text[at - 1];
    const after = text[at + phrase.length];
    if (!(before && WORD.test(before)) && !(after && WORD.test(after))) return true;
  }
  return false;
}

export function englishShowing(found: readonly Finding[], phrases: readonly string[]): Finding[] {
  return found.filter((f) => phrases.some((phrase) => showsPhrase(f.text, phrase)));
}

/**
 * Text that doesn't fit. The heuristic, for every rendered box that isn't inline
 * and is bigger than a pixel (so screen-reader-only text is skipped):
 *
 * - horizontal: content wider than the box (scrollWidth > clientWidth + 1).
 *   Hidden, clipped or ellipsis overflow means cut-off text; visible overflow
 *   means text spilling out of its box. Both fail. Boxes meant to scroll
 *   sideways opt out with data-scroll-x. A person's own words cut with an
 *   ellipsis, the whole text in the box's title, are left out (UX round 1).
 * - vertical: content taller than a box that clips it (overflow hidden or clip,
 *   or a line clamp). Vertical scroll containers are fine.
 *
 * The whole page must also fit the window width.
 *
 * `boxes` is the CSS selector of the boxes to read (all of the page's by default); with another, the page-width
 * check is left to a call without it.
 */
export async function clippedText(page: Page, boxes = 'body *'): Promise<Finding[]> {
  return page.evaluate((selector) => {
    const problems: { text: string; where: string }[] = [];
    const label = (el: Element) => {
      const slot = el.getAttribute('data-slot');
      const text = (el.textContent ?? '').trim().slice(0, 60);
      return { text, where: `${el.tagName.toLowerCase()}${slot ? `[${slot}]` : ''}` };
    };
    if (selector === 'body *' && document.documentElement.scrollWidth > window.innerWidth + 1) {
      problems.push({ text: 'page is wider than the window', where: 'html' });
    }
    for (const el of document.querySelectorAll(selector)) {
      if (!(el instanceof HTMLElement) || el.closest('[data-scroll-x]')) continue;
      const style = getComputedStyle(el);
      if (style.display === 'inline' || style.display === 'contents' || style.display === 'none') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      // A person's own words (a chat's title) cut with an ellipsis, all of them in the box's tooltip: data of any
      // length, not UI text that has to fit (UX round 1).
      const ownWords =
        style.textOverflow === 'ellipsis' &&
        el.title !== '' &&
        el.title === el.textContent?.trim() &&
        el.querySelector('[data-user-content]') !== null;
      if (ownWords) continue;
      const wide = el.scrollWidth - el.clientWidth > 1;
      const tall = el.scrollHeight - el.clientHeight > 1;
      const clipsY =
        style.overflowY === 'hidden' ||
        style.overflowY === 'clip' ||
        style.getPropertyValue('-webkit-line-clamp') !== 'none';
      if (wide)
        problems.push({
          ...label(el),
          where: `${label(el).where} (too wide: ${el.scrollWidth} > ${el.clientWidth})`,
        });
      else if (tall && clipsY) problems.push({ ...label(el), where: `${label(el).where} (clipped height)` });
    }
    return problems;
  }, boxes);
}

/**
 * Form fields whose words are cut short inside the control, which clippedText can't see (the box never overflows):
 * a select's chosen option, an empty text field's placeholder. `boxes` as for clippedText.
 */
export async function clippedFields(page: Page, boxes = 'body *'): Promise<Finding[]> {
  return page.evaluate((selector) => {
    const context = document.createElement('canvas').getContext('2d');
    const problems: { text: string; where: string }[] = [];
    const shown = (el: Element): string | null => {
      if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.textContent?.trim() ?? null;
      if (el instanceof HTMLInputElement && el.value === '' && el.placeholder) return el.placeholder;
      return null;
    };
    for (const el of document.querySelectorAll(selector)) {
      const text = shown(el);
      if (!text || !context || !(el instanceof HTMLElement) || el.getBoundingClientRect().width <= 1)
        continue;
      const style = getComputedStyle(el);
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const needs = context.measureText(text).width;
      if (needs > room + 1)
        problems.push({
          text,
          where: `${el.tagName.toLowerCase()} (needs ${Math.ceil(needs)} > ${Math.floor(room)})`,
        });
    }
    return problems;
  }, boxes);
}
