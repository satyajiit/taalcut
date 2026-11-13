// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Sounds trending in Edits, the page's client entry · mode: Operate · system: WEB2 Remix Vernacular
 * what the feature page, the features index and the fact rows import by name: the showcase (edits-showcase.tsx), its
 *   fragment, and each fact's icon and scene (scenes.tsx), in the facts' order (#content/features-more)
 * states: the parts' own */

import { AudioLines, Gauge, Music, Send, type LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Scene } from '../vignette';
import { HandoffScene, HooksScene, ScoresScene, SoundsScene } from './scenes';

export { EditsFragment, EditsShowcase } from './edits-showcase';

/** Each fact's icon and scene, in the order of the feature's facts (#content/features-more). */
export const EDITS_ROWS: readonly { readonly icon: LucideIcon; readonly Scene: ComponentType<Scene> }[] = [
  { icon: Music, Scene: SoundsScene },
  { icon: AudioLines, Scene: HooksScene },
  { icon: Gauge, Scene: ScoresScene },
  { icon: Send, Scene: HandoffScene },
];
