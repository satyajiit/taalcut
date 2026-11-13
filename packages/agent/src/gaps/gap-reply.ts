// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: an answer to the gaps question written in the chat instead of on the card, pure. "I added a clip, try
 * again" is Add more clips; "use the walkway clip for the first shot" names a clip the card offered that shot (by the
 * words of its description) and a shot (by number, "first" or "opening", "last"); "drop shot 3", "film it", "keep
 * them" and "go ahead" take the card's own fixes. Each gap the words don't name keeps the card's proposed fix. Words
 * it can't tie to the card answer nothing, and the message goes on as a message of its own. English words only.
 */
import type { GapFixKind } from '@taalcut/core';
import type { GapAnswer } from './answers';
import type { GapsJoinData } from './gap-card';

type Gap = GapsJoinData['gaps'][number];

const ORDINALS: Readonly<Record<string, number>> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
};

/** Words that name no clip. */
const PLAIN = new Set([
  'a',
  'an',
  'and',
  'another',
  'any',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'clip',
  'clips',
  'do',
  'for',
  'from',
  'give',
  'go',
  'have',
  'here',
  'i',
  'in',
  'instead',
  'into',
  'is',
  'it',
  'its',
  'just',
  'last',
  'let',
  'me',
  'my',
  'of',
  'on',
  'one',
  'opening',
  'other',
  'part',
  'please',
  'put',
  'shot',
  'shots',
  'so',
  'start',
  'swap',
  'take',
  'that',
  'the',
  'then',
  'there',
  'this',
  'to',
  'try',
  'use',
  'video',
  'want',
  'with',
  'you',
  'your',
  'hook',
  'again',
  'same',
  'reuse',
  'borrow',
  'move',
  'now',
  'ok',
  'okay',
  'yes',
  'beginning',
]);

const ADDED =
  /\b(added|add|adding|imported|import|uploaded|upload|sent|put in|dropped in)\b[^.!?]*\b(clips?|videos?|footage|files?|shots?|more)\b/;
const AGAIN = /\b(try|cast|look|check|search) again\b|\bretry\b|\btry once more\b/;
const DEFAULTS =
  /^(ok(ay)?|yes|yep|yeah|sure|go ahead|go on|sounds good|looks good|do it|fine|that'?s fine|use (your|the) (picks|choices|suggestions|defaults))\b/;
const WORDED: readonly (readonly [GapFixKind, RegExp])[] = [
  ['drop', /\b(drop|remove|cut|delete|skip|lose)\b/],
  ['film', /\b(film|shoot|record)\b/],
  ['generate', /\b(generate|ai image|make (a|an) (image|picture|still))\b/],
  ['stock', /\bstock\b/],
  ['keep', /\b(keep|leave)\b|\bas (it|they) (is|are)\b/],
];

const stem = (word: string) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word);
const wordsOf = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !PLAIN.has(w) && !(w in ORDINALS))
      .map(stem),
  );

/** The shot numbers the words name, or [] when they name none. */
function shotsNamed(text: string, data: GapsJoinData): number[] {
  const named = new Set<number>();
  for (const match of text.matchAll(/\b(?:shots?|#)\s*(\d{1,3})\b|\b(\d{1,3})(?:st|nd|rd|th)\b/g))
    named.add(Number(match[1] ?? match[2]));
  for (const [word, number] of Object.entries(ORDINALS))
    if (new RegExp(`\\b${word}\\b`).test(text)) named.add(number);
  if (/\b(opening|hook|beginning)\b/.test(text)) named.add(1);
  if (/\b(last|final)\b/.test(text))
    for (const timeline of data.timelines) if (timeline.summary) named.add(timeline.summary.shots);
  return [...named];
}

interface Offered {
  readonly kind: 'swap' | 'borrow' | 'reuse';
  readonly assetId: string;
  readonly shotId: string | null;
  readonly description: string | null;
}

function offeredClips(gap: Gap): Offered[] {
  return gap.view.options.flatMap((option): Offered[] =>
    option.kind === 'swap' || option.kind === 'borrow' || option.kind === 'reuse'
      ? option.candidates.map((c) => ({ kind: option.kind, ...c }))
      : [],
  );
}

/** The one offered clip the words name best among these gaps, or undefined (none, or two equally). */
function namedClip(text: string, gaps: readonly Gap[]): { gap: Gap; clip: Offered } | undefined {
  const words = wordsOf(text);
  if (words.size === 0) return undefined;
  const preferReuse = /\b(another part|other part|again|same clip|reuse)\b/.test(text);
  const scored = gaps.flatMap((gap) =>
    offeredClips(gap).map((clip) => {
      const own = wordsOf(clip.description ?? '');
      const shared = [...words].filter((w) => own.has(w)).length;
      return { gap, clip, score: shared + (preferReuse && clip.kind === 'reuse' ? 0.5 : 0) };
    }),
  );
  const best = scored.filter((s) => s.score >= 1).sort((a, b) => b.score - a.score);
  const [first, second] = best;
  if (!first) return undefined;
  const sameClip = second && second.clip.assetId === first.clip.assetId && second.gap === first.gap;
  return second && second.score === first.score && !sameClip ? undefined : first;
}

/** The fix the words ask for, without a clip: Add more clips, a worded fix, or the card's own (`defaults`). */
function wordedFix(text: string): GapFixKind | 'defaults' | undefined {
  if (ADDED.test(text) || AGAIN.test(text)) return 'addClips';
  for (const [kind, pattern] of WORDED) if (pattern.test(text)) return kind;
  return DEFAULTS.test(text.trim()) ? 'defaults' : undefined;
}

const proposed = (gap: Gap): GapAnswer => ({
  gapId: gap.view.gapId,
  fix: gap.row.fix,
  ...(gap.row.swapTo ? { swapTo: gap.row.swapTo } : {}),
});

/**
 * The answer the chat message gives the question, for every open gap on the card, or undefined when the words
 * don't answer it (no fix named, a shot that isn't open, or a fix that shot isn't offered).
 */
export function gapReply(message: string, data: GapsJoinData): GapAnswer[] | undefined {
  const text = message.toLowerCase().replace(/\s+/g, ' ');
  const open = data.gaps.filter((g) => !g.settled);
  if (open.length === 0) return undefined;
  const named = shotsNamed(text, data);
  const targets = named.length > 0 ? open.filter((g) => named.includes(g.view.number)) : open;
  if (named.length > 0 && targets.length === 0) return undefined;
  const chosen = new Map<string, GapAnswer>();

  const fix = wordedFix(text);
  const clip = fix === 'addClips' ? undefined : namedClip(text, targets);
  if (clip) {
    const { assetId, shotId } = clip.clip;
    chosen.set(clip.gap.view.gapId, {
      gapId: clip.gap.view.gapId,
      fix: clip.clip.kind,
      swapTo: { assetId, shotId },
    });
  } else if (fix === 'defaults') {
    return open.map(proposed);
  } else if (fix) {
    const offers = (gap: Gap) =>
      gap.view.options.some((o) => o.kind === fix) || (fix === 'keep' && gap.row.fixes.includes('keep'));
    const takers = named.length > 0 ? targets : targets.filter(offers);
    if (takers.length === 0 || !takers.every(offers)) return undefined;
    for (const gap of takers) chosen.set(gap.view.gapId, { gapId: gap.view.gapId, fix });
  } else return undefined;

  return open.map((gap) => chosen.get(gap.view.gapId) ?? proposed(gap));
}
