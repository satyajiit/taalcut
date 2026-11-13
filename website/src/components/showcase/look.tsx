// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: each feature's look · mode: Persuade · system: WEB2 Remix Vernacular
 * states: none (data and class maps, no markup of its own).
 * A feature's icon, colour job, the app window's active area and Kaatu's pose, the stickers' fields and icons, and the
 * class maps that turn a job into a chip or a text colour. */

import { AudioLines, Captions, CircleDashed, Link, ListChecks, Repeat, Search, Undo2, Upload, Wifi, Check } from 'lucide-react';
import { ICONS } from '#lib/icons';
import type { FeatureJob, FeatureLook } from './look-types';
import { LOOK as ImportLook } from './import/meta';
import { LOOK as ShortsLook } from './shorts/meta';
import { LOOK as InstagramEditsLook } from './instagram-edits/meta';
import { LOOK as LaunchVideosLook } from './launch-videos/meta';
import { LOOK as ProductVideosLook } from './product-videos/meta';
import { LOOK as PluginsLook } from './plugins/meta';

/**
 * How each feature looks in the Remix Vernacular world: its glyph and the colour job its chip carries, the area of
 * the app its window opens on, Kaatu's pose beside its header, and each header sticker's field and glyph (the words
 * are in #content/features, FEATURE_STICKERS, in the same order). 'ai' is the Avartan's AI mark, never a sparkle.
 */

export type { FeatureJob, FeatureLook, LookIcon } from './look-types';

export const LOOKS: Readonly<Record<string, FeatureLook>> = {
  'import': ImportLook,
  'shorts': ShortsLook,
  'instagram-edits': InstagramEditsLook,
  'launch-videos': LaunchVideosLook,
  'product-videos': ProductVideosLook,
  'plugins': PluginsLook,
  'reel-breakdown': {
    icon: ICONS.breakdown,
    job: 'beat',
    area: 'templates',
    pose: 'headphones',
    stickers: [
      { field: 'sky', icon: Link },
      { field: 'pink', icon: AudioLines },
      { field: 'lime', icon: CircleDashed },
    ],
  },
  'auto-pick': {
    icon: ICONS.clip,
    job: 'you',
    area: 'library',
    pose: 'search',
    stickers: [
      { field: 'teal', icon: Wifi },
      { field: 'sky', icon: Search },
      { field: 'violet', icon: 'ai' },
    ],
  },
  templates: {
    icon: ICONS.template,
    job: 'beat',
    area: 'templates',
    pose: 'carry-strip',
    stickers: [
      { field: 'teal', icon: Repeat },
      { field: 'pink', icon: AudioLines },
      { field: 'violet', icon: ICONS.slot },
    ],
  },
  agent: {
    icon: 'ai',
    job: 'ai',
    area: 'agent',
    pose: 'laptop',
    stickers: [
      { field: 'violet', icon: ListChecks },
      { field: 'marigold', icon: Check },
      { field: 'sky', icon: Undo2 },
    ],
  },
  editor: {
    icon: ICONS.trim,
    job: 'you',
    area: 'make',
    pose: 'snip',
    stickers: [
      { field: 'pink', icon: ICONS.trim },
      { field: 'teal', icon: Captions },
      { field: 'paper', icon: Upload },
    ],
  },
};

/** The features index's own look: the Make glyph, ink, Kaatu pointing the way down the list. */
export const INDEX_LOOK: FeatureLook = {
  icon: ICONS.make,
  job: 'ink',
  area: 'make',
  pose: 'point',
  stickers: [
    { field: 'violet', icon: ICONS.make },
    { field: 'sky', icon: Link },
    { field: 'pink', icon: ICONS.clip },
  ],
};

export function lookOf(slug: string): FeatureLook {
  if (slug === 'index') return INDEX_LOOK;
  const look = LOOKS[slug];
  if (!look) throw new Error(`No look for ${slug}`);
  return look;
}

/** A job's chip: its soft field and strong glyph (ink is the inverse chip). */
export const JOB_CHIP: Readonly<Record<FeatureJob, string>> = {
  beat: 'bg-rose-soft text-rose-strong',
  you: 'bg-teal-soft text-teal-strong',
  ink: 'bg-inverse text-on-inverse',
  ai: 'bg-violet-soft text-violet-strong',
};

/** A job's glyph colour alone, for an icon row. */
export const JOB_TEXT: Readonly<Record<FeatureJob, string>> = {
  beat: 'text-rose-strong',
  you: 'text-teal-strong',
  ink: 'text-ink',
  ai: 'text-violet-strong',
};
