// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { beforeAfterModule } from './before-after';
import { dayInTheLifeModule } from './day-in-the-life';
import { highlightReelModule } from './highlight-reel';
import { podcastClipModule } from './podcast-clip';
import { talkingHeadModule } from './talking-head';
import { tutorialModule } from './tutorial';
import { ugcAdModule } from './ugc-ad';
import { vlogModule } from './vlog';

/** One import per format, in FORMAT_IDS order. A new format is a new line here. */
export const FORMAT_MODULES = [
  vlogModule,
  dayInTheLifeModule,
  talkingHeadModule,
  podcastClipModule,
  ugcAdModule,
  beforeAfterModule,
  tutorialModule,
  highlightReelModule,
] as const;
