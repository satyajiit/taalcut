// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Templates area's glyphs, one per thing, all from the kit's registry (CONCEPT_ICONS, VERB_ICONS), named here by
 * the area's own words.
 */
import { CONCEPT_ICONS, VERB_ICONS } from '@taalcut/ui';

export const TEMPLATE_ICONS = {
  // The area's views.
  mine: CONCEPT_ICONS.template,
  new: VERB_ICONS.add,
  startFrom: CONCEPT_ICONS.startFrom,
  saved: CONCEPT_ICONS.saved,
  // Start from…'s views.
  starter: CONCEPT_ICONS.starter,
  format: CONCEPT_ICONS.format,
  community: CONCEPT_ICONS.hub,
  // A template's views.
  overview: CONCEPT_ICONS.overview,
  slots: CONCEPT_ICONS.slot,
  pacing: CONCEPT_ICONS.pacing,
  details: CONCEPT_ICONS.info,
  version: CONCEPT_ICONS.version,
  // Your templates' places.
  all: CONCEPT_ICONS.all,
  favourites: CONCEPT_ICONS.favourite,
  unfiled: CONCEPT_ICONS.unfiled,
  watched: CONCEPT_ICONS.watched,
  folder: CONCEPT_ICONS.folder,
  // Actions.
  makeVideo: VERB_ICONS.makeVideo,
  copy: VERB_ICONS.copy,
  readReel: VERB_ICONS.readReel,
  import: VERB_ICONS.import,
  open: VERB_ICONS.open,
  retry: VERB_ICONS.retry,
  clearFilters: VERB_ICONS.clearFilters,
  share: VERB_ICONS.share,
  settings: VERB_ICONS.settings,
  signOut: VERB_ICONS.signOut,
  sync: VERB_ICONS.checkAgain,
} as const;
