// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: beat-strip · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.2
 * states: n/a (static, decorative)
 */
import { StaggerGroup, StaggerItem, cn } from '@taalcut/ui';

// Slots in beats (a template is its cuts on the music's beats); twelve beats in all.
const SLOTS = ['col-span-3', 'col-span-2', 'col-span-2', 'col-span-1', 'col-span-4'] as const;

/**
 * What a template is, drawn empty: the reference's slots as neutral blocks,
 * each starting on one of the rose beat ticks under them. Decorative.
 */
export function BeatStrip({ className }: { className?: string }) {
  return (
    <div aria-hidden data-slot="beat-strip" className={cn('flex flex-col gap-1.5', className)}>
      <StaggerGroup className="grid h-8 grid-cols-12 gap-1">
        {SLOTS.map((span, i) => (
          <StaggerItem
            key={i}
            className={cn(
              span,
              'rounded-clip border border-rule-subtle bg-raised transition-transform duration-(--dur-micro) ease-(--ease-out) hover:-translate-y-0.5',
            )}
          >
            <span className="sr-only" />
          </StaggerItem>
        ))}
      </StaggerGroup>
      <div className="grid grid-cols-12 gap-1">
        {Array.from({ length: 12 }, (_, i) => (
          <span
            key={i}
            className={cn('block w-0.5 rounded-pill bg-beat-strong', i % 4 === 0 ? 'h-2.5' : 'h-1.5')}
          />
        ))}
      </div>
    </div>
  );
}
