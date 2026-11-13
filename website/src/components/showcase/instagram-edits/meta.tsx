// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* instagram-edits: this feature's look and its showcase's words (WEB3 lane B).
 * Server-safe data: no 'use client', so the page's server code can read it. The look: the beat's rose job (the
 * sounds and their hook drops), the app window open on Make where the shelf sits, Kaatu in his headphones, and the
 * header's three stickers (Trending in Edits, Hook drops marked, Cut on the beat). */

import { AudioLines, Scissors, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FeatureLook } from '../look-types';

export const LOOK: FeatureLook = {
  icon: AudioLines,
  job: 'beat',
  area: 'make',
  pose: 'headphones',
  stickers: [
    { field: 'pink', icon: TrendingUp },
    { field: 'lime', icon: AudioLines },
    { field: 'violet', icon: Scissors },
  ],
};

/** The showcase's heading, and its one line on how to use what is in the window. */
export const HINT: { readonly title: string; readonly hint: ReactNode } = {
  title: 'Sounds trending in Edits',
  hint: 'Switch the tabs and the licence, then choose a sound to play it to its hook. Cut with AI lays your next video on its beats, ready to stage in Edits.',
};
