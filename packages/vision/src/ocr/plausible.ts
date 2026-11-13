// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drops readings no asked language could have written (IX-O4). Vision, with
 * language detection on, reads busy texture as Arabic-Indic digits ("٠٠٠"),
 * Han ("好好你好"), or bare punctuation ("....", ".°"): on the ix-v1 bench
 * library 13 of the 43 stored texts were these, and each one is a track whose
 * edges cost refinement reads. A reading is kept when it has a letter or digit
 * and at least `plausibleScriptShare` of its letters and digits are Latin,
 * ASCII digits, or a script of an asked language. Latin always counts: brands,
 * numbers and English words sit on screen in every language. A language this
 * table doesn't know switches the script check off for that call.
 */
import { ok } from '@taalcut/core';
import { VISION_CONFIG } from '../config';
import { baseLanguage, normaliseText } from './text';
import type { OcrEngine, OcrObservation, OcrPage } from './types';

/** Scripts beyond Latin that each language writes; [] for Latin-only languages. */
const SCRIPTS: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(
    'en es pt fr de it nl sv da no nb nn fi pl cs sk ro hu tr id ms vi ca hr sl et lv lt tl sw'
      .split(' ')
      .map((language) => [language, []]),
  ),
  hi: ['Devanagari'],
  mr: ['Devanagari'],
  ne: ['Devanagari'],
  zh: ['Han'],
  ja: ['Han', 'Hiragana', 'Katakana'],
  ko: ['Hangul', 'Han'],
  ru: ['Cyrillic'],
  uk: ['Cyrillic'],
  bg: ['Cyrillic'],
  ar: ['Arabic'],
  fa: ['Arabic'],
  ur: ['Arabic'],
  th: ['Thai'],
  he: ['Hebrew'],
  el: ['Greek'],
};

/** Vision's own default set when no language is asked. */
const DEFAULT_LANGUAGES = ['en', 'es', 'pt'];

const ALNUM = /[\p{L}\p{Nd}]/gu;

/** The letters and digits these languages write, or undefined when one of them isn't known. */
export function writtenBy(languages: readonly string[]): RegExp | undefined {
  const scripts = new Set(['Latin']);
  for (const language of languages.length > 0 ? languages : DEFAULT_LANGUAGES) {
    const own = SCRIPTS[baseLanguage(language)];
    if (!own) return undefined;
    for (const script of own) scripts.add(script);
  }
  const classes = [...scripts].map((script) => `\\p{Script=${script}}`).join('');
  return new RegExp(`^(?:[0-9]|[${classes}])$`, 'u');
}

/** Whether a reading has a letter or digit, mostly in a script `written` accepts. */
export function plausible(observation: OcrObservation, written: RegExp | undefined): boolean {
  const alnum = normaliseText(observation.text).match(ALNUM) ?? [];
  if (alnum.length === 0) return false;
  if (!written) return true;
  const own = alnum.filter((char) => written.test(char)).length;
  return own / alnum.length >= VISION_CONFIG.ocr.plausibleScriptShare;
}

export function plausiblePage(page: OcrPage, written: RegExp | undefined): OcrPage {
  const observations = page.observations.filter((o) => plausible(o, written));
  return observations.length === page.observations.length ? page : { frame: page.frame, observations };
}

/** The engine, with each call's implausible readings dropped. */
export function keepPlausible(engine: OcrEngine): OcrEngine {
  return {
    capabilities: () => engine.capabilities(),
    async recognize(frames, options) {
      const pages = await engine.recognize(frames, options);
      if (!pages.ok) return pages;
      const written = writtenBy(options.languages);
      return ok(pages.value.map((page) => plausiblePage(page, written)));
    },
    ...(engine.close ? { close: () => engine.close?.() ?? Promise.resolve() } : {}),
  };
}
