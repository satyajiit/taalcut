// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* plugins: this feature's look and its showcase's words (WEB3 lanes B, then P).
 * Server-safe data: no 'use client', so the page's server code can read it. The look: ink (no colour job owns
 * plugins), the app window led by a video on Make, Kaatu at his keyboard, and the header's three stickers (Postiz and
 * Instagram Edits, You choose what it may do, Claude Code and Codex). */

import { Bot, Puzzle, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FeatureLook } from '../look-types';

export const LOOK: FeatureLook = {
  icon: Puzzle,
  job: 'ink',
  area: 'make',
  pose: 'type',
  stickers: [
    { field: 'sky', icon: Puzzle },
    { field: 'teal', icon: ShieldCheck },
    { field: 'paper', icon: Bot },
  ],
};

/** The showcase's heading, and its one line on how to use what is in the window. */
export const HINT: { readonly title: string; readonly hint: ReactNode } = {
  title: 'Plugins and agents, at work on a video',
  hint: 'Answer Claude Code’s ask and approve the post. Below, in Settings, open a plugin’s views, connect Claude Code or Codex, then revoke it.',
};
