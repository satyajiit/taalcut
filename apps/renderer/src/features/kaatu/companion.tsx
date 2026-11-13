// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the companion (UX4) · system: DESIGN.md "Mascot", UX4
 * Kaatu at the sidebar's foot, sitting on the hairline above Settings, centred on the rows' icon column, which is
 *   the rail's centre too, so it doesn't move when the sidebar folds: 40 px open, 32 on the rail (scaled from its
 *   feet, so it stays seated). Calm: it doesn't turn to
 *   the pointer and its antics are rare, so it lives at the edge of the eye.
 * states (moods, from the app's state): idle · thinking (something runs) · happy (work done, a moment) · oops
 *   (something failed, a moment) · asleep (a quiet minute; nightfall dozes it). Not a control: no focus, no hover
 *   style; a poke is a game. Hidden with Show Kaatu off.
 * motion: Kaatu's own; the size change on the rail is a transform over --dur-short (at once under reduced motion).
 */
import { cn, Kaatu, useKaatuShown, useSidebarFold } from '@taalcut/ui';
import { useCompanionMood } from './use-companion-mood';

export function Companion({ className }: { className?: string }) {
  const { rail } = useSidebarFold();
  const mood = useCompanionMood();
  const shown = useKaatuShown();
  if (!shown) return null;
  return (
    <div
      aria-hidden
      data-slot="companion"
      data-mood={mood}
      className={cn('flex h-11 w-10 items-end justify-center', className)}
    >
      <span
        className={cn(
          'block origin-bottom transition-transform duration-(--dur-short) ease-(--ease-out)',
          rail && 'scale-80',
        )}
      >
        {/* Without Kaatu's optical inset: the companion is centred on its own column, and its box holds all of
            it (the inset would leave the drawing 7 px outside each side of its wrapper). */}
        <Kaatu spot="companion" mood={mood} calm className="mx-0!" />
      </span>
    </div>
  );
}
