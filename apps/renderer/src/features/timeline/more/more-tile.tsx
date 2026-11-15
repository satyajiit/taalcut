// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a More tile (MORE1) · system: DESIGN.md v0.7
 * one action of the More tab as a raised plate you press: a chip that shows the action (its glyph on its
 *   family's wash, or the value itself: the transition drawn, the look on the scene's own frame, the cover),
 *   the action's name, and its value now in words. Pressing it opens the action's surface. Its name to a screen
 *   reader is both lines ("Speed, Normal speed"), as they are written
 * colour: a family per kind of change, never the only sign (the glyph and the name say which): time is sky,
 *   the join between two scenes orchid, the picture coral, the whole video lime; who picked the shot keeps its
 *   own colour (violet the AI, teal you)
 * states: default (raised, the rule hairline, the xs lift) · hover (a stronger edge and the sm lift: it rises,
 *   it does not darken) · focus (the base ring) · active (the pressed surface, no lift, gives 1 %) · open (its
 *   family's edge) · off (flat
 *   and quiet, aria-disabled so it can still be reached and read: its own reason in the value's place, or the
 *   group's line named as its description)
 * motion: the value's words fade in when they change (never on arrival); reduced motion: the same fade, shorter
 */
import { cn, Glyph, PRESS_ROW, type IconComponent } from '@taalcut/ui';
import { useEffect, useRef, type ReactNode, type Ref } from 'react';

/** What a tile changes: the family its chip takes its colour from. */
export type TileFamily = 'time' | 'join' | 'picture' | 'video' | 'ai' | 'you' | 'neutral';

const FAMILY: Readonly<
  Record<TileFamily, { readonly chipClassName: string; readonly openClassName: string }>
> = {
  time: { chipClassName: 'bg-sky-soft text-sky-strong', openClassName: 'border-sky-strong' },
  join: { chipClassName: 'bg-orchid-soft text-orchid-strong', openClassName: 'border-orchid-strong' },
  picture: { chipClassName: 'bg-coral-soft text-coral-strong', openClassName: 'border-coral-strong' },
  video: { chipClassName: 'bg-lime-soft text-lime-strong', openClassName: 'border-lime-strong' },
  ai: { chipClassName: 'bg-ai-soft text-ai-strong', openClassName: 'border-ai-strong' },
  you: { chipClassName: 'bg-you-soft text-you-strong', openClassName: 'border-you-strong' },
  neutral: { chipClassName: 'bg-chip text-ink-3', openClassName: 'border-rule-strong' },
};

export interface TileChipProps {
  family: TileFamily;
  icon?: IconComponent | undefined;
  /** A picture or a drawn motif in the glyph's place: it fills the chip. */
  children?: ReactNode;
  className?: string;
}

/** The tile's chip: 32 px (36 in a roomy panel), the family's wash, a 20 px glyph or the value's own picture. */
export function TileChip({ family, icon, children, className }: TileChipProps) {
  return (
    <span
      aria-hidden
      data-slot="more-chip"
      data-family={family}
      className={cn(
        'relative inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md min-[1280px]:size-9',
        FAMILY[family].chipClassName,
        className,
      )}
    >
      {children ?? (icon ? <Glyph icon={icon} size="lg" /> : null)}
    </span>
  );
}

export interface MoreTileProps {
  /** Which action it is (`data-tile`). */
  id: string;
  family: TileFamily;
  icon?: IconComponent | undefined;
  /** The value drawn in the chip, in the glyph's place. */
  picture?: ReactNode;
  name: string;
  /** The value now, in words (or, on a quiet tile, what the action would do). */
  value: string;
  /** Why this one can't be used, in words: shown in the value's place. */
  reason?: string | null | undefined;
  /** It reads but does not act: flat and quiet. `reason`, or the line `describedBy` names, says why. */
  still?: boolean;
  /** The id of a line that says why the whole group waits. */
  describedBy?: string | undefined;
  /** Its surface is open. */
  open?: boolean;
  /** The surface is a dialog. */
  dialog?: boolean;
  /** Kept at the tile's end (a wide tile's extra fact). */
  trailing?: ReactNode;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
  onOpen(): void;
}

export function MoreTile({
  id,
  family,
  icon,
  picture,
  name,
  value,
  reason,
  still = false,
  describedBy,
  open = false,
  dialog = false,
  trailing,
  className,
  ref,
  onOpen,
}: MoreTileProps) {
  const off = still || !!reason;
  const line = reason ?? value;
  // The words fade in when they change, never when the tile arrives.
  const arrived = useRef(false);
  useEffect(() => {
    arrived.current = true;
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      data-slot="more-tile"
      data-tile={id}
      data-state={off ? 'off' : open ? 'open' : 'ready'}
      aria-disabled={off || undefined}
      aria-haspopup={dialog ? 'dialog' : undefined}
      aria-describedby={describedBy}
      onClick={() => {
        if (!off) onOpen();
      }}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-lg border p-1.5 text-start',
        'min-[1280px]:min-h-14 min-[1280px]:px-2.5 min-[1280px]:py-2',
        off
          ? 'cursor-not-allowed border-rule-subtle'
          : cn(
              'cursor-pointer bg-raised shadow-xs',
              PRESS_ROW,
              'hover:shadow-sm active:bg-pressed active:shadow-none',
              open ? FAMILY[family].openClassName : 'border-rule hover:border-rule-strong',
            ),
        className,
      )}
    >
      <TileChip family={off ? 'neutral' : family} icon={icon}>
        {picture}
      </TileChip>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('type-label break-words', off ? 'text-ink-2' : 'text-ink')}>{name}</span>
        <span
          key={line}
          data-slot="more-tile-value"
          className={cn('type-meta break-words text-ink-2', arrived.current && 'animate-fade-in')}
        >
          {line}
        </span>
      </span>
      {trailing}
    </button>
  );
}
