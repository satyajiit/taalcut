// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Around the app: motion/react follows the Mac's Reduce motion setting, so
 * layout moves (the sidebar's fold, the current row's mark) happen at once and
 * only opacity still eases (DESIGN.md, "Motion rules").
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
