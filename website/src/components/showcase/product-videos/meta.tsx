// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* product-videos: this feature's look and its showcase's words (the product-videos lane's file).
 * Server-safe data: no 'use client', so the page's server code can read it. */

import { CalendarClock, Check, Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FeatureLook } from '../look-types';

/**
 * A product is yours, and so are its ideas' sources: an ink lightbulb, the window open on Products, Kaatu pointing at
 * the next idea. The header's stickers carry, in order, an idea per feature, the schedule, and the approval.
 */
export const LOOK: FeatureLook = {
  icon: Lightbulb,
  job: 'ink',
  area: 'products',
  pose: 'point',
  stickers: [
    { field: 'lime', icon: Lightbulb },
    { field: 'sky', icon: CalendarClock },
    { field: 'paper', icon: Check },
  ],
};

/** The showcase's heading, and its one line on how to use what is in the window. */
export const HINT: { readonly title: string; readonly hint: ReactNode } = {
  title: 'Video ideas for Taalcut, from taalcut.app',
  hint: 'Choose an idea’s reel to make it your video, then approve its post. Find video ideas brings other features; the research days are under it all.',
};
