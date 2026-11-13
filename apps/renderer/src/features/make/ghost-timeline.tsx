// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: ghost-timeline · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.4
 * states: n/a (static, decorative; empty states never move: logo motion spec §6; no hover lift, it is not a
 *   control, UX1)
 */
import { StaggerGroup, StaggerItem, cn } from '@taalcut/ui';

/**
 * The shape of a cut before there is one: neutral clip blocks on the sunken
 * bed, cut on rose beat ticks, with the marigold playhead at the start
 * (DESIGN.md, "Timeline"). Decorative: hidden from assistive tech; the words
 * beside it say what will appear.
 */

const BEATS = 16;
// Clips in beats; every cut lands on a beat, which is the point of the product.
const CUTS = [4, 2, 3, 3, 4] as const;
// Tailwind needs the full class names in the source.
const SPAN: Record<number, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-3',
  4: 'col-span-4',
  6: 'col-span-6',
};
// A caption track: a few short text slots, placed on beats too.
const CAPTIONS = [
  { start: 'col-start-1', span: 'col-span-3' },
  { start: 'col-start-7', span: 'col-span-2' },
  { start: 'col-start-10', span: 'col-span-4' },
] as const;

export interface GhostTimelineProps {
  /** Full: video, captions and beats, for the timeline page. Compact: video and beats. */
  size?: 'full' | 'compact';
  className?: string;
}

export function GhostTimeline({ size = 'compact', className }: GhostTimelineProps) {
  const full = size === 'full';
  return (
    <div
      aria-hidden
      data-slot="ghost-timeline"
      className={cn('flex w-full flex-col gap-2 rounded-xl border border-rule-subtle bg-sunken p-4', className)}
    >
      <div className="relative">
        {/* Video track: one row of clips, edge to edge, each cut on a beat. */}
        <StaggerGroup className={cn('grid grid-cols-16 gap-1', full ? 'h-20' : 'h-14')}>
          {CUTS.map((beats, i) => (
            <StaggerItem
              key={i}
              className={cn(
                SPAN[beats],
                'rounded-clip border border-rule-subtle bg-raised',
                i > 1 && 'opacity-70',
              )}
            >
              <span className="sr-only" />
            </StaggerItem>
          ))}
        </StaggerGroup>
        {/* The playhead, at the start: nothing has played yet. */}
        <div className="absolute -top-2 -bottom-2 left-0 w-0.5 rounded-pill bg-playhead" />
      </div>
      {full ? (
        <StaggerGroup className="grid h-6 grid-cols-16 gap-1">
          {CAPTIONS.map((caption) => (
            <StaggerItem
              key={caption.start}
              className={cn(caption.start, caption.span, 'rounded-clip border border-dashed border-rule')}
            >
              <span className="sr-only" />
            </StaggerItem>
          ))}
        </StaggerGroup>
      ) : null}
      {/* Beats: rose ticks under the clips, taller on each bar's first beat. */}
      <StaggerGroup className="grid grid-cols-16 gap-1">
        {Array.from({ length: BEATS }, (_, i) => (
          <StaggerItem key={i}>
            <span
              className={cn('block w-0.5 rounded-pill bg-beat-strong', i % 4 === 0 ? 'h-3' : 'h-1.5')}
            />
          </StaggerItem>
        ))}
      </StaggerGroup>
    </div>
  );
}
