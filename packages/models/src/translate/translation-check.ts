// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The translator's output rules (SPEC P3.4): the asked ids once each and no others, plain text (no markup or fence
 * tags), and at most twice the source's length in graphemes. Very short sources ("OK") get a floor, since a natural
 * translation of an interjection can be three times as long.
 */
import { err, ok, type Result, type TranslationUnit } from '@taalcut/core';
import type { TranslationsCall } from './translation-prompt';

export const LENGTH_RULE = { ratio: 2, floorGraphemes: 16 } as const;

const MARKUP = /<\/?[a-z][^>]*>|<\/?\s*untrusted|```/i;

const graphemes = (text: string) =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;

/** The translations in the request's order, or what is wrong with them (model-facing). */
export function checkTranslations(
  asked: readonly TranslationUnit[],
  answer: TranslationsCall,
): Result<TranslationUnit[], string> {
  const byId = new Map<string, string>();
  for (const unit of answer.units) {
    if (byId.has(unit.id)) return err(`id ${JSON.stringify(unit.id)} appears twice`);
    byId.set(unit.id, unit.text.trim());
  }
  const extra = answer.units.find((unit) => !asked.some((a) => a.id === unit.id));
  if (extra) return err(`id ${JSON.stringify(extra.id)} was not asked for`);
  const out: TranslationUnit[] = [];
  for (const unit of asked) {
    const text = byId.get(unit.id);
    if (text === undefined) return err(`id ${JSON.stringify(unit.id)} is missing`);
    if (text.length === 0 && unit.text.trim().length > 0)
      return err(`id ${JSON.stringify(unit.id)} is empty`);
    if (MARKUP.test(text)) return err(`id ${JSON.stringify(unit.id)} has markup`);
    const limit = Math.max(LENGTH_RULE.floorGraphemes, LENGTH_RULE.ratio * graphemes(unit.text));
    if (graphemes(text) > limit)
      return err(`id ${JSON.stringify(unit.id)} is over twice its source's length`);
    out.push({ id: unit.id, text });
  }
  return ok(out);
}
