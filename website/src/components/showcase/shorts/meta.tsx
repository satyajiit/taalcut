// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* shorts: this feature's look and its showcase's words (WEB3; the shorts lane owns this file).
 * Server-safe data: no 'use client', so the page's server code can read it. Violet is the job: the AI reads the long
 * video and picks the short. Kaatu holds up a 9:16 reel card (its pose), the portrait short. */

import { Captions, Film, RectangleVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FeatureLook } from '../look-types';

export const LOOK: FeatureLook = {
  icon: RectangleVertical,
  job: 'ai',
  area: 'library',
  pose: 'hold-reel',
  stickers: [
    { field: 'marigold', icon: Film },
    { field: 'violet', icon: 'ai' },
    { field: 'pink', icon: Captions },
  ],
};

/** The showcase's heading, and its one line on how to use what is in the window. */
export const HINT: { readonly title: string; readonly hint: ReactNode } = {
  title: 'A long video, made short',
  hint: 'Choose a length and press Create short. Point at a sentence to read it, and play the short from any of its parts.',
};
