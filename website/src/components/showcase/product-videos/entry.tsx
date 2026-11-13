// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: product-videos's showcase, its index fragment and its fact rows' scenes · mode: Operate · system: WEB2
 *   Remix Vernacular
 * the names the page, the features index and the fact rows import: ProductShowcase (product-showcase.tsx: Products ›
 *   Taalcut, its ideas from taalcut.app, the schedule, a video and its post), ProductFragment (product-fragment.tsx:
 *   the ideas and the lines behind them) and PRODUCT_ROWS (vignettes.tsx, one scene a fact)
 * states: the modules' own */

import { CalendarClock, Clapperboard, Lightbulb, Send, type LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Scene } from '../vignette';
import { IdeasScene, PostScene, ReadyScene, ScheduleScene } from './vignettes';

export { ProductShowcase } from './product-showcase';
export { ProductFragment } from './product-fragment';

/** Each fact's icon and scene, in the order of the feature's facts (#content/features-more). */
export const PRODUCT_ROWS: readonly { readonly icon: LucideIcon; readonly Scene: ComponentType<Scene> }[] = [
  { icon: Lightbulb, Scene: IdeasScene },
  { icon: CalendarClock, Scene: ScheduleScene },
  { icon: Clapperboard, Scene: ReadyScene },
  { icon: Send, Scene: PostScene },
];
