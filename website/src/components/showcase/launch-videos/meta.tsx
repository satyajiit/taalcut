// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* launch-videos: this feature's look and its showcase's words (the launch-videos lane's file).
 * Server-safe data: no 'use client', so the page's server code can read it. */

import { Check, Link, RectangleHorizontal, Rocket } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FeatureLook } from '../look-types';

/**
 * A launch is the AI's work from your brief: violet, a rocket, the window open on Create, Kaatu at a laptop. The
 * header's stickers carry, in order, the brief and its sources, the approval, and the formats.
 */
export const LOOK: FeatureLook = {
  icon: Rocket,
  job: 'ai',
  area: 'create',
  pose: 'laptop',
  stickers: [
    { field: 'violet', icon: Link },
    { field: 'marigold', icon: Check },
    { field: 'sky', icon: RectangleHorizontal },
  ],
};

/** The showcase's heading, and its one line on how to use what is in the window. */
export const HINT: { readonly title: string; readonly hint: ReactNode } = {
  title: 'Taalcut’s own launch video, in four formats',
  hint: 'Production makes it scene by scene when you scroll to it, then it plays. Change a scene’s words or length and approve again, turn a format off, or open it in the editor.',
};
