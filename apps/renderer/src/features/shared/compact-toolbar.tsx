// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: compact window-bar words · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a page's own secondary actions in the window bar show their icon under 1280 px, the word in a tooltip and to
 *   screen readers; from 1280 px, the default window, the word sits beside the icon. (It was 1440 px while main's
 *   GitHub links shared the bar; they moved to the Help menu, ⌘K and Settings › About in UX1.) A page's one
 *   marigold fill keeps its word at every width.
 * states: the Button's own (default, hover, focus-visible, active, disabled, loading) · the tooltip on hover and
 *   focus under 1280 px only
 */
import { Tooltip, TooltipContent, TooltipTrigger } from '@taalcut/ui';
import type { ReactElement, ReactNode } from 'react';

/** A window-bar button's word: beside the icon from 1280 px, for screen readers only below. */
export const COMPACT_WORD = 'sr-only xl:not-sr-only';

/** The word in a tooltip while the button shows only its icon (under 1280 px). */
export function CompactTip({
  label,
  children,
}: {
  readonly label: ReactNode;
  readonly children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="xl:hidden">{label}</TooltipContent>
    </Tooltip>
  );
}
