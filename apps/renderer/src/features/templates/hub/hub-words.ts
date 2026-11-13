// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The hub pages' fixed words (P3-B12, P3-V8): formats, sorts, report reasons and the languages to filter by. */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { FormatId, HubReportReason, HubSort } from '@taalcut/core';

/** Each format's short name; the same words as the template library's Format filter. */
export const HUB_FORMAT_NAMES: Readonly<Record<FormatId, MessageDescriptor>> = {
  vlog: msg`Vlog`,
  dayInTheLife: msg`Day in the life`,
  talkingHead: msg`Talking to camera`,
  podcastClip: msg`Podcast clip`,
  ugcAd: msg`Product ad`,
  beforeAfter: msg`Before and after`,
  tutorial: msg`How-to`,
  highlightReel: msg`Highlight reel`,
};

export const SORT_NAMES: Readonly<Record<HubSort, MessageDescriptor>> = {
  topRated: msg`Top rated`,
  newest: msg`Newest`,
  freshest: msg`Freshest trend`,
};

export const REPORT_REASONS: Readonly<
  Record<HubReportReason, { readonly label: MessageDescriptor; readonly hint: MessageDescriptor }>
> = {
  copyright: { label: msg`It copies someone else’s work`, hint: msg`Their idea, their name, their brand.` },
  personalInfo: {
    label: msg`It shows personal information`,
    hint: msg`A name, a place, a number that points to someone.`,
  },
  spam: { label: msg`It’s spam or an ad`, hint: msg`Posted again and again, or there to sell something.` },
  offensive: { label: msg`It’s hateful or offensive`, hint: msg`Words that attack or demean people.` },
  other: { label: msg`Something else`, hint: msg`Say what in the note.` },
};

/** The languages the filter offers: the app's own, and Hindi for the hub's Indian creators. */
export const HUB_LANGUAGES = ['en', 'es', 'pt-BR', 'hi'] as const;
