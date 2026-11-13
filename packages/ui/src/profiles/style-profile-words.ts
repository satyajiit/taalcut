// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The words a style profile is shown in (LRN1-STY): its vocabularies (core's STYLE_* lists) and the heading for
 * each kind of set. Every map is exhaustive, so a new value in core fails the typecheck here.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { StyleProfile, StyleSource } from '@taalcut/core';

type Value<T extends readonly { value: string }[]> = T[number]['value'];

export const TRANSITION_WORDS: Readonly<
  Record<Value<StyleProfile['mix']['transitions']>, MessageDescriptor>
> = {
  cut: msg`Straight cuts`,
  dissolve: msg`Dissolves`,
  fade: msg`Fades`,
  whip: msg`Whips`,
  zoom: msg`Zooms`,
  slide: msg`Slides`,
  flash: msg`Flashes`,
  glitch: msg`Glitches`,
  other: msg`Other transitions`,
};

export const POSITION_WORDS: Readonly<
  Record<Value<StyleProfile['overlays']['position']>, MessageDescriptor>
> = {
  top: msg`At the top`,
  middle: msg`In the middle`,
  bottom: msg`At the bottom`,
};

export const SIZE_WORDS: Readonly<Record<Value<StyleProfile['overlays']['size']>, MessageDescriptor>> = {
  small: msg`Small text`,
  medium: msg`Medium text`,
  large: msg`Large text`,
};

export const SOUND_WORDS: Readonly<Record<Value<StyleProfile['audio']['kind']>, MessageDescriptor>> = {
  music: msg`Music`,
  voice: msg`Someone talking`,
  original: msg`The clips’ own sound`,
  mixed: msg`Talking over music`,
  silent: msg`No sound`,
};

export const ASPECT_WORDS: Readonly<Record<Value<StyleProfile['form']['aspect']>, MessageDescriptor>> = {
  '9:16': msg`Vertical (9:16)`,
  '4:5': msg`Portrait (4:5)`,
  '1:1': msg`Square (1:1)`,
  '16:9': msg`Landscape (16:9)`,
  other: msg`Another shape`,
};

/** The section's title: what the set is, in the person's terms. */
export const HEADING_WORDS: Readonly<Record<StyleSource['kind'], MessageDescriptor>> = {
  'instagram-collection': msg`What your saved reels have in common`,
  folder: msg`What these templates have in common`,
  tag: msg`What these templates have in common`,
  'my-exports': msg`What your own videos have in common`,
};

/** A set with nothing broken down yet: what fills it. */
export const EMPTY_WORDS: Readonly<Record<StyleSource['kind'], MessageDescriptor>> = {
  'instagram-collection': msg`Nothing to compare yet. Turn a few of these Reels into templates, and Taalcut shows what they have in common.`,
  folder: msg`Nothing to compare yet. Add templates to this folder, and Taalcut shows what they have in common.`,
  tag: msg`Nothing to compare yet. Tag a few templates with this, and Taalcut shows what they have in common.`,
  'my-exports': msg`Nothing to compare yet. Export a video made from a template, and Taalcut shows what yours have in common.`,
};

/**
 * A set needs this many members before it has anything in common: with fewer, the numbers are one template's own,
 * so the section says so and lists no "most like the rest".
 */
export const STYLE_PROFILE_COMPARE_MIN = 2;

/** A set of one template: its numbers are that template's, and what makes it a set to compare. */
export const ONE_TEMPLATE_WORDS: Readonly<Record<StyleSource['kind'], MessageDescriptor>> = {
  'instagram-collection': msg`One template has nothing to compare with yet, so these are its own numbers. Turn another of these Reels into a template, and Taalcut shows what they have in common.`,
  folder: msg`One template has nothing to compare with yet, so these are its own numbers. Add another to this folder, and Taalcut shows what they have in common.`,
  tag: msg`One template has nothing to compare with yet, so these are its own numbers. Tag another with this, and Taalcut shows what they have in common.`,
  'my-exports': msg`One template has nothing to compare with yet, so these are its own numbers. Export a video made from another template, and Taalcut shows what yours have in common.`,
};
