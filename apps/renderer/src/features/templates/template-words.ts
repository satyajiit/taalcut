// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { FormatId, TemplateSummary } from '@taalcut/core';

/** Where the reel came from, as people say it. */
export const PLATFORM_LABELS: Readonly<Record<NonNullable<TemplateSummary['platform']>, MessageDescriptor>> =
  {
    shorts: msg`YouTube Shorts`,
    reels: msg`Instagram Reels`,
    tiktok: msg`TikTok`,
    other: msg`A video`,
  };

/**
 * The built-in formats (templates.formats): a name and one line for each of core's eight FORMAT_IDS, the same
 * list the templates service returns, and the message a chat opens with when one is picked (UX1: a format acts).
 * The contract names them by message key; the words live here, keyed by the format's id.
 */
export const FORMAT_WORDS: Readonly<
  Record<FormatId, { name: MessageDescriptor; description: MessageDescriptor; ask: MessageDescriptor }>
> = {
  vlog: {
    name: msg`Vlog`,
    description: msg`A short story of your day or a trip: a hook, the moments, a sign-off.`,
    ask: msg`Make a vlog from my clips.`,
  },
  dayInTheLife: {
    name: msg`Day in the life`,
    description: msg`Morning to night in quick cuts, each moment on the beat.`,
    ask: msg`Make a day-in-the-life video from my clips.`,
  },
  talkingHead: {
    name: msg`Talking to camera`,
    description: msg`You on camera making your points, with cutaways that show what you mean.`,
    ask: msg`Make a talking-to-camera video from my clips.`,
  },
  podcastClip: {
    name: msg`Podcast clip`,
    description: msg`The most quotable moment of a conversation, with the speaker’s name and captions.`,
    ask: msg`Make a podcast clip from my recording.`,
  },
  ugcAd: {
    name: msg`Product ad`,
    description: msg`A problem, the product in your hands, the result and an offer.`,
    ask: msg`Make a product ad from my clips.`,
  },
  beforeAfter: {
    name: msg`Before and after`,
    description: msg`Each before cut against its after, ending on the finished result.`,
    ask: msg`Make a before-and-after video from my clips.`,
  },
  tutorial: {
    name: msg`How-to`,
    description: msg`The result first, then each step with its label, then the finished thing.`,
    ask: msg`Make a how-to video from my clips.`,
  },
  highlightReel: {
    name: msg`Highlight reel`,
    description: msg`Action that builds to a peak, one moment in slow motion, and the best one last.`,
    ask: msg`Make a highlight reel from my clips.`,
  },
};

/** Every format's short name, for the library's Format filter and a template's facts (P3-V14). */
export const FORMAT_NAMES: Readonly<Record<FormatId, MessageDescriptor>> = {
  vlog: msg`Vlog`,
  dayInTheLife: msg`Day in the life`,
  talkingHead: msg`Talking to camera`,
  podcastClip: msg`Podcast clip`,
  ugcAd: msg`Product ad`,
  beforeAfter: msg`Before and after`,
  tutorial: msg`How-to`,
  highlightReel: msg`Highlight reel`,
};

/** What made a version, from the command that made it. */
const VERSION_WORDS: Readonly<Record<string, MessageDescriptor>> = {
  'template.slot.rename': msg`Slot renamed`,
  'template.slot.merge': msg`Slots merged`,
  'template.slot.drop': msg`Slot dropped`,
  'template.slot.approve': msg`Slots approved`,
  'template.slot.editIntent': msg`Slot changed`,
  'template.rename': msg`Renamed`,
  'template.setHead': msg`Went back a version`,
};

export function versionWords(command: string | null): MessageDescriptor {
  if (command === null) return msg`Read from the reel`;
  return VERSION_WORDS[command] ?? msg`Changed`;
}
