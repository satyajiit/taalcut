// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useEffect, useState } from 'react';
import type { OnboardingStep } from './steps';

/** A first-run screen: the welcome or a step. */
export type FirstRunScreen = OnboardingStep | 'welcome';

/**
 * The first-run screen shown before this one in this window, or null when this is the first (a launch, a reload, a
 * link). Only the screen's motion reads it: a step reached from another one arrives and its rail's beat glides; the
 * screen a window opens on is simply there (DESIGN.md: what was there when the page opened shows at once).
 */
let shown: FirstRunScreen | null = null;

/** The screen before this one (read once, when it opens), and this one remembered for the next. */
export function useCameFrom(screen: FirstRunScreen): FirstRunScreen | null {
  const [from] = useState(() => (shown === screen ? null : shown));
  useEffect(() => {
    shown = screen;
  }, [screen]);
  return from;
}
