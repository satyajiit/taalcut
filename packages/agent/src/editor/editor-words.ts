// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: the words of a docked message that point at something on screen, resolved against the editor context
 * (SPEC section 38): "this", "it" and "that" are the selection, or with nothing selected what is under the playhead;
 * "here" and "now" are the playhead; "the next clip" and "the previous clip" count from the clip in focus; "the
 * second clip", "clip 3" and "the last clip" count clips from the start, as the editor numbers them. In the four v1
 * languages. Pure: the same message, context and timeline always give the same answer.
 */
import type { EditItemPlace, EditItemTarget, EditorContext } from '@taalcut/core';
import { asciiDigits, LAST, ORDINAL_WORDS, SLOT_NOUNS } from '../timestamps/lexicon';

/** "a|b c|d" → ['a', 'b c', 'd']. */
const phrases = (list: string): readonly string[] => list.split('|');

/** The selection, or what is under the playhead. */
export const THIS_WORDS = phrases(
  'this|that|it|these|those|this one|that one|este|esta|esto|ese|esa|eso|isto|esse|essa|isso|यह|ये|इस|इसे|इसको|वह|उसे',
);
/** The playhead. */
export const HERE_WORDS = phrases('here|now|right here|aquí|aqui|ahora|agora|यहाँ|यहां|अभी');
export const NEXT_WORDS = phrases('next|following|siguiente|próximo|próxima|seguinte|अगला|अगली|अगले');
export const PREVIOUS_WORDS = phrases('previous|prior|anterior|पिछला|पिछली|पिछले');

/** What the words point at: a few targets, or the playhead. */
export interface EditorMention {
  /** The words as written, at most 80 characters. */
  readonly said: string;
  readonly targets: readonly EditItemTarget[];
  /** True for "here" and "now": the playhead (and the clip under it). */
  readonly playhead?: true;
}

const START = '(?<![\\p{L}\\p{M}\\p{N}])';
const END = '(?![\\p{L}\\p{M}\\p{N}])';
const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (words: readonly string[]) =>
  [...words]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
const NOUN = `(?:${alt(SLOT_NOUNS)})s?`;
const ORDINAL = alt(Object.keys(ORDINAL_WORDS));
/** A clip noun, or "one" ("the next one"). */
const ONE = `(?:one|${NOUN})`;
/** `words` before a clip noun, or after it ("el clip siguiente"). */
const around = (words: string) =>
  new RegExp(`${START}(?:${words})\\s+${ONE}${END}|${START}${NOUN}\\s+(?:${words})${END}`, 'giu');
const PATTERNS = {
  ordinal: new RegExp(`${START}(${ORDINAL})\\s+${ONE}${END}|${START}${NOUN}\\s+(${ORDINAL})${END}`, 'giu'),
  numbered: new RegExp(`${START}${NOUN}\\s*(?:#|no\\.?\\s*|n[º°]\\s*)?(\\d{1,3})${END}`, 'giu'),
  next: around(alt(NEXT_WORDS)),
  previous: around(alt(PREVIOUS_WORDS)),
  here: new RegExp(`${START}(?:${alt(HERE_WORDS)})${END}`, 'giu'),
  this: new RegExp(`${START}(?:${alt(THIS_WORDS)})${END}`, 'giu'),
};

export interface EditorFocus {
  /** The items the selection names, first selected first. */
  readonly selected: readonly EditItemPlace[];
  /** The clip in focus: the first selected clip, else the clip under the first selected item, else at the playhead. */
  readonly clip: EditItemPlace | null;
  /** What is under the playhead: the clip, and any text, graphic or caption showing there. */
  readonly underPlayhead: readonly EditItemPlace[];
}

const covers = (place: EditItemPlace, frame: number) => frame >= place.start && frame < place.end;

/** The selection and the playhead as items of the timeline. */
export function editorFocus(
  context: EditorContext,
  places: readonly EditItemPlace[],
  frame: number,
): EditorFocus {
  const byId = new Map(places.map((place) => [place.target.itemId as string, place]));
  const selected = context.selection.flatMap((target) => {
    const place = target.kind === 'item' ? byId.get(target.itemId) : undefined;
    return place ? [place] : [];
  });
  const clips = places.filter((place) => place.target.itemKind === 'clip');
  const underPlayhead = places.filter(
    (place) =>
      place.target.itemKind !== 'transition' && place.target.itemKind !== 'audio' && covers(place, frame),
  );
  const firstSelected = selected[0];
  const clipAt = (at: number) =>
    clips.find((clip) => covers(clip, at)) ?? (at >= 0 ? clips.at(-1) : undefined);
  const clip =
    selected.find((place) => place.target.itemKind === 'clip') ??
    (firstSelected ? clipAt(firstSelected.start) : undefined) ??
    clipAt(frame) ??
    null;
  return { selected, clip, underPlayhead };
}

const said = (text: string) => text.trim().slice(0, 80);

/** Each pointing phrase in the message, resolved; nothing for words the timeline can't answer. */
export function editorMentions(
  message: string,
  focus: EditorFocus,
  places: readonly EditItemPlace[],
): EditorMention[] {
  const text = asciiDigits(message);
  const clips = places.filter((place) => place.target.itemKind === 'clip');
  const clipNumbered = (n: number) => (n === LAST ? clips.at(-1) : clips[n - 1]);
  const out: EditorMention[] = [];
  const taken: [number, number][] = [];
  const free = (index: number, length: number) =>
    taken.every(([start, end]) => index + length <= start || index >= end);
  const add = (
    match: RegExpMatchArray,
    targets: readonly (EditItemPlace | undefined)[],
    playhead = false,
  ) => {
    const index = match.index ?? 0;
    if (!free(index, match[0].length)) return;
    taken.push([index, index + match[0].length]);
    const found = targets.flatMap((place) => (place ? [place.target] : []));
    if (found.length > 0 || playhead)
      out.push({ said: said(match[0]), targets: found, ...(playhead ? { playhead: true as const } : {}) });
  };
  for (const match of text.matchAll(PATTERNS.ordinal)) {
    const word = (match[1] ?? match[2] ?? '').toLowerCase();
    add(match, [clipNumbered(ORDINAL_WORDS[word] ?? 0)]);
  }
  for (const match of text.matchAll(PATTERNS.numbered)) add(match, [clipNumbered(Number(match[1]))]);
  const current = focus.clip
    ? clips.findIndex((clip) => clip.target.itemId === focus.clip!.target.itemId)
    : -1;
  for (const match of text.matchAll(PATTERNS.next))
    add(match, [current >= 0 ? clips[current + 1] : undefined]);
  for (const match of text.matchAll(PATTERNS.previous))
    add(match, [current > 0 ? clips[current - 1] : undefined]);
  for (const match of text.matchAll(PATTERNS.here)) add(match, focus.clip ? [focus.clip] : [], true);
  const these = focus.selected.length > 0 ? focus.selected : focus.underPlayhead.slice(0, 1);
  for (const match of text.matchAll(PATTERNS.this)) add(match, these);
  return out.sort((a, b) => text.indexOf(a.said) - text.indexOf(b.said)).slice(0, 8);
}
