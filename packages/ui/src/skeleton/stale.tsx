// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: stale content (what is on screen while newer data loads) · genre: atmospheric studio app
 * (chrome modern-minimal) · system: DESIGN.md v0.3 + v0.4 (UX1: stale data is never shown as current) · the last
 * answer stays where it is, readable, and dims after 150 ms (an answer that is quick never flickers); it comes
 * back at once when the new one lands. A re-read of the same inputs (`refreshing`) only says it is busy: the
 * answer is still the right one, so it doesn't dim. aria-busy for VoiceOver. Opacity only; reduced motion: the
 * 150 ms fade. Not a control: no eight states of its own.
 * UX4: `asChild` puts it on the caller's own element (a table's scroll frame, a tile strip), so a hand copy of
 * `stale && 'opacity-55'` becomes one wrapper with no extra box. */
import { Slot } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '#lib/cn';

export interface StaleContentProps {
  /** The content is the answer for other inputs while the new one loads (useRpcQuery's `stale`). Dims. */
  stale: boolean;
  /** The same inputs are being read again (useRpcQuery's `refreshing`): busy, but not dimmed. */
  busy?: boolean;
  children: ReactNode;
  className?: string;
  /** Dim your own element (its classes, data and role stay) instead of wrapping it in a div. */
  asChild?: boolean;
}

/**
 * Wraps a list or a panel whose inputs just changed (new filters, another clip): the old content stays in place,
 * dimmed and marked busy, until the new content replaces it. Use bones instead when there was nothing before.
 */
export function StaleContent({
  stale,
  busy = false,
  asChild = false,
  children,
  className,
}: StaleContentProps) {
  const Root = asChild ? Slot.Root : 'div';
  return (
    <Root
      data-slot="stale-content"
      data-stale={stale || undefined}
      aria-busy={stale || busy || undefined}
      className={cn(
        'transition-opacity duration-(--dur-short) ease-(--ease-out)',
        stale && 'opacity-55 delay-150',
        className,
      )}
    >
      {children}
    </Root>
  );
}
