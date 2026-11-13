// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The changes card's words (EDT1-CTX): what a row's item is called ("Clip 3", "Opening title", "The video") and
 * what changed about it ("2.4s → 1.8s", "moved to the top"). Every map is exhaustive, so a new kind in core fails
 * the typecheck here. A change to words keeps them apart (`words`): they are the user's or the agent's content,
 * shown as written, never translated.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { EditChange, EditChangeRow, EditItemKind } from '@taalcut/core';
import type { Rate, Timecode } from '../make/timecode';

const MS: Rate = { num: 1000, den: 1 };

type Of<K extends EditChange['kind']> = Extract<EditChange, { kind: K }>;

export const PLACE_WORDS: Readonly<Record<Of<'place'>['after'], MessageDescriptor>> = {
  top: msg`moved to the top`,
  middle: msg`moved to the middle`,
  bottom: msg`moved to the bottom`,
};

export const FRAMING_WORDS: Readonly<Record<Of<'framing'>['after'], MessageDescriptor>> = {
  cover: msg`fills the frame`,
  contain: msg`whole, with bars`,
  auto: msg`follows the action`,
  subject: msg`follows the subject`,
  centre: msg`centred`,
  blurPad: msg`whole, on a blur`,
};

export const TRANSITION_KIND_WORDS: Readonly<Record<Of<'transition'>['after'], MessageDescriptor>> = {
  dissolve: msg`dissolve`,
  fade: msg`fade`,
  whip: msg`whip`,
  zoom: msg`zoom`,
  slide: msg`slide`,
  flash: msg`flash`,
  glitch: msg`glitch`,
  other: msg`other`,
};

export const SETTING_WORDS: Readonly<Record<Of<'setting'>['what'], MessageDescriptor>> = {
  music: msg`The music changed`,
  captions: msg`The captions changed`,
  look: msg`The look changed`,
  voiceover: msg`The voiceover changed`,
  mix: msg`The sound mix changed`,
};

const ITEM_NAMES: Readonly<Record<EditItemKind, (n: string) => MessageDescriptor>> = {
  clip: (n) => msg`Clip ${n}`,
  text: (n) => msg`Text ${n}`,
  graphic: (n) => msg`Graphic ${n}`,
  caption: (n) => msg`Caption ${n}`,
  audio: (n) => msg`Audio ${n}`,
  transition: (n) => msg`Transition ${n}`,
};

/** What a row's item is called: "Clip 3", "Opening title", "Title 2", "The video". */
export function changeTarget(i18n: I18n, row: Pick<EditChangeRow, 'target' | 'number' | 'role'>): string {
  const { target } = row;
  if (target.kind === 'timeline') return i18n._(msg`The video`);
  if (target.kind === 'range') return i18n._(msg`Part of the video`);
  const n = i18n.number(row.number ?? 1);
  if (target.itemKind === 'text' && row.role === 'title')
    return row.number === 1 ? i18n._(msg`Opening title`) : i18n._(msg`Title ${n}`);
  return i18n._(ITEM_NAMES[target.itemKind](n));
}

const seconds = (i18n: I18n, value: number) =>
  i18n.number(value, { style: 'unit', unit: 'second', unitDisplay: 'narrow', maximumFractionDigits: 1 });

const speedWord = (i18n: I18n, value: Of<'speed'>['after']) => {
  if (value === 'ramp') return i18n._(msg`a speed ramp`);
  const times = i18n.number(value, { maximumFractionDigits: 2 });
  return i18n._(msg`${times}×`);
};

const volumeWord = (i18n: I18n, value: number | null) => {
  if (value === null) return i18n._(msg`muted`);
  const db = i18n.number(value, { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  return i18n._(msg`${db} dB`);
};

/**
 * HFW1: a graphic's new design, as one phrase: "Chat bubble · new design v1 → v2 · proposed". The name is the
 * designing model's words, shown as written; the versions are numbers.
 */
const designWords = (i18n: I18n, change: Of<'design'>): string => {
  const { name } = change.after;
  const from = i18n.number(change.before.version);
  const to = i18n.number(change.after.version);
  return change.proposed
    ? i18n._(msg`${name} · new design v${from} → v${to} · proposed`)
    : i18n._(msg`${name} · new design v${from} → v${to}`);
};

/**
 * HFW1-UI: the design row's parts, for the card to show the name as content: the name as the model wrote it, and
 * what happened in this language ("new design v1 → v2 · proposed").
 */
export function designParts(
  i18n: I18n,
  change: Of<'design'>,
): { readonly name: string; readonly what: string } {
  const from = i18n.number(change.before.version);
  const to = i18n.number(change.after.version);
  return {
    name: change.after.name,
    what: change.proposed
      ? i18n._(msg`new design v${from} → v${to} · proposed`)
      : i18n._(msg`new design v${from} → v${to}`),
  };
}

/** A before and an after, both already words. */
export interface ChangeSpan {
  readonly before: string;
  readonly after: string;
}

/**
 * What changed, in words: a before and an after ("2.4s" → "1.8s"), or one phrase ("added"). `words` changes are
 * the item's own text, returned as is for the card to show as content.
 */
export function changeWords(i18n: I18n, time: Timecode, change: EditChange): ChangeSpan | string {
  // Seconds as an editor's clock, to the millisecond.
  const clock = (value: number) => time.clock(Math.round(value * 1000), MS);
  switch (change.kind) {
    case 'added':
      return i18n._(msg`added`);
    case 'removed':
      return i18n._(msg`removed`);
    case 'length':
      return { before: seconds(i18n, change.before), after: seconds(i18n, change.after) };
    case 'start':
      return { before: clock(change.before), after: clock(change.after) };
    case 'order': {
      const from = i18n.number(change.before);
      const to = i18n.number(change.after);
      return i18n._(msg`moved from place ${from} to ${to}`);
    }
    case 'words':
      return { before: change.before, after: change.after };
    case 'place':
      return i18n._(PLACE_WORDS[change.after]);
    case 'speed':
      return { before: speedWord(i18n, change.before), after: speedWord(i18n, change.after) };
    case 'media':
      return i18n._(msg`new footage`);
    case 'part':
      return change.after > change.before
        ? i18n._(msg`plays a later part of its shot`)
        : i18n._(msg`plays an earlier part of its shot`);
    case 'framing':
      return { before: i18n._(FRAMING_WORDS[change.before]), after: i18n._(FRAMING_WORDS[change.after]) };
    case 'transition':
      return {
        before: i18n._(TRANSITION_KIND_WORDS[change.before]),
        after: i18n._(TRANSITION_KIND_WORDS[change.after]),
      };
    case 'volume':
      return { before: volumeWord(i18n, change.before), after: volumeWord(i18n, change.after) };
    case 'design':
      return designWords(i18n, change);
    case 'setting':
      return i18n._(SETTING_WORDS[change.what]);
    case 'other':
      return i18n._(msg`changed`);
  }
}

/** One row as plain text, for its accessible name: "Clip 3: 2.4s → 1.8s", "Graphic 1: moved to the top". */
export function changeLine(i18n: I18n, time: Timecode, row: EditChangeRow): string {
  const name = changeTarget(i18n, row);
  const what = changeWords(i18n, time, row.change);
  // A whole-video setting, and a new design (named by its design: "Chat bubble · new design v1 → v2"), say it all.
  if (row.change.kind === 'setting' || row.change.kind === 'design') return what as string;
  if (typeof what === 'string') return i18n._(msg`${name}: ${what}`);
  const { before, after } = what;
  return i18n._(msg`${name}: ${before} → ${after}`);
}
