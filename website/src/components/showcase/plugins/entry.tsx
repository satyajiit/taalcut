// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Plugins and other agents, the page's client entry · mode: Operate · system: WEB2 Remix Vernacular
 * what the feature page, the features index and the fact rows import by name: the showcase (plugins-showcase.tsx),
 *   its fragment, and each fact's icon and scene (scenes.tsx), in the facts' order (#content/features-more)
 * states: the parts' own */

import { AudioLines, Bot, Send, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Scene } from '../vignette';
import { AgentsScene, EditsPluginScene, PostizScene, YourSayScene } from './scenes';

export { PluginsFragment, PluginsShowcase } from './plugins-showcase';

/** Each fact's icon and scene, in the order of the feature's facts (#content/features-more). */
export const PLUGINS_ROWS: readonly { readonly icon: LucideIcon; readonly Scene: ComponentType<Scene> }[] = [
  { icon: Send, Scene: PostizScene },
  { icon: AudioLines, Scene: EditsPluginScene },
  { icon: ShieldCheck, Scene: YourSayScene },
  { icon: Bot, Scene: AgentsScene },
];
