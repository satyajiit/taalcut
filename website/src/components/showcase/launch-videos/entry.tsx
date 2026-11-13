// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: launch-videos's showcase, its index fragment and its fact rows' scenes · mode: Operate · system: WEB2
 *   Remix Vernacular
 * the names the page, the features index and the fact rows import: LaunchShowcase (launch-showcase.tsx: Taalcut's own
 *   launch video leading, in four formats, with the brief, sources and script as a rail under it), LaunchFragment
 *   (launch-fragment.tsx: the video playing in its four formats) and LAUNCH_ROWS (vignettes.tsx, one scene a fact)
 * states: the modules' own */

import { Camera, Check, Link, RectangleHorizontal, type LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { Scene } from '../vignette';
import { ApproveScene, CaptureScene, FormatScene, SourcesScene } from './vignettes';

export { LaunchShowcase } from './launch-showcase';
export { LaunchFragment } from './launch-fragment';

/** Each fact's icon and scene, in the order of the feature's facts (#content/features-more). */
export const LAUNCH_ROWS: readonly { readonly icon: LucideIcon; readonly Scene: ComponentType<Scene> }[] = [
  { icon: Link, Scene: SourcesScene },
  { icon: Camera, Scene: CaptureScene },
  { icon: Check, Scene: ApproveScene },
  { icon: RectangleHorizontal, Scene: FormatScene },
];
