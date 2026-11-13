// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: rail tooltip (React Bits WarmTooltip, adapted) · genre: atmospheric studio app · system: DESIGN.md v0.2
 * the icon rail's names: an ink chip beside the icon. The first waits 800 ms under the pointer and opens at once on
 *   keyboard focus; while one is open (and 300 ms after), the next opens at once and the chip glides to it.
 * motion: pop 150 ms (opacity, scale 0.96 → 1), glide 220 ms on --ease-out, no overshoot, no blur.
 *   Reduced motion: no glide or pop.
 * states: closed · opening (cold, after the delay) · open · gliding (warm) · closing; Escape closes it.
 */
import WarmTooltip, { WarmTooltipGroup } from '@taalcut-vendor/react-bits/warm-tooltip';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '#lib/cn';
import { useShortcutFormat } from '../palette/key-words';

/** One group per rail, so a tooltip can glide from icon to icon. */
export function RailTooltipGroup({ children }: { children: ReactNode }) {
  return (
    <WarmTooltipGroup delay={800} warmWindow={300} travel={220}>
      {children}
    </WarmTooltipGroup>
  );
}

export interface RailTooltipProps {
  /** The row's name, translated. */
  label: string;
  /** Its keyboard shortcut, as an accelerator ("mod+k"). */
  shortcut?: string;
  /** Off (no tooltip) while the sidebar is open: the words are on the row. */
  disabled?: boolean;
  /** For the trigger's wrapper (full width by default, like a row). */
  className?: string;
  children: ReactElement<Record<string, unknown>>;
}

/** A rail icon's name (and shortcut), to its right. */
export function RailTooltip({ label, shortcut, disabled = false, className, children }: RailTooltipProps) {
  const format = useShortcutFormat();
  return (
    <WarmTooltip
      content={label}
      shortcut={shortcut ? format.text(shortcut) : undefined}
      side="right"
      gap={10}
      disabled={disabled}
      className={cn('flex! w-full', className)}
    >
      {children}
    </WarmTooltip>
  );
}
