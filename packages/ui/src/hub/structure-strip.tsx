// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H5 E4 S5 R5 V4
 * Hallmark · component: structure strip (U6 strip mode) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (Timeline: slots are neutral blocks; rose = beats; marigold = the playhead) · the template
 *   page's SlotStrip look, read-only: blocks sized by length on a rose beat lane, the hook, the peak and the ending
 *   with their role's data mark along the top (UX3: kinds)
 * states: still (default) · playing (the playhead runs the first 3 s, the block under it lifts) · reduced motion
 *   (still, always) · n/a: hover/focus/active/disabled/loading/error/success belong to the row that holds it
 * motion: the parent's one clock. The playhead is a Web Animation on transform (UX4 B18: the compositor runs it);
 *   the block under it changes at the cuts only; nothing else moves
 */
import { useRef, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { ROLE_KIND } from '../templates/kinds';
import { SHOT_GLYPHS, SHOT_TONES } from './preview-glyphs';
import type { PreviewModel } from './structure-of';
import { STILL_CLOCK, useClockAnimation, type StructureClock } from './use-structure-clock';

export interface StructureStripProps {
  readonly model: PreviewModel;
  /** Seconds into the structure; null draws no playhead. */
  readonly time: number | null;
  readonly current: number | null;
  /** The preview's clock and how much of the structure it loops: the playhead runs on them between cuts. */
  readonly clock?: StructureClock | undefined;
  readonly loop?: number | undefined;
  /**
   * `plate`: neutral blocks on the page (a hub row, Share). `viewer`: on the viewer grey, each block in its shot's
   * tone with the shot's glyph, as a storyboard (Start from…'s cards, UX4 tpl).
   */
  readonly look?: 'plate' | 'viewer';
  readonly className?: string;
}

/** Every beat while they are a few pixels apart; past 24 in a strip, each bar's first only. */
function beatsToDraw(beats: readonly number[]): readonly number[] {
  return beats.length > 24 ? beats.filter((_, index) => index % 4 === 0) : beats;
}

/** Where the playhead's layer sits at `time`: moved from -100% to 0, its right edge is the playhead. */
export const playheadAt = (time: number, total: number): string =>
  `translateX(${(time / total) * 100 - 100}%)`;

/**
 * A full-width layer that rides the clock: the playhead is its right edge, so it travels by transform alone and
 * never sticks out past the end. Between cuts it is a Web Animation over the loop; the inline transform is where
 * it stood at the last cut, for a browser without one.
 */
export function ClockPlayhead({
  time,
  total,
  loop,
  clock,
  slot,
  className,
  children,
}: {
  readonly time: number;
  readonly total: number;
  readonly loop: number;
  readonly clock: StructureClock | undefined;
  /** The layer's `data-slot`, for the specs that find it. */
  readonly slot?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const layer = useRef<HTMLSpanElement>(null);
  const frames = clock ? [{ transform: playheadAt(0, total) }, { transform: playheadAt(loop, total) }] : null;
  useClockAnimation(layer, frames, `${loop}/${total}`, {
    clock: clock ?? STILL_CLOCK,
    duration: loop * 1000,
    iterations: Number.POSITIVE_INFINITY,
    at: () => (clock ? clock.now() * 1000 : 0),
  });
  return (
    <span ref={layer} data-slot={slot} className={className} style={{ transform: playheadAt(time, total) }}>
      {children}
    </span>
  );
}

/** One slot's block: neutral on a plate, its shot's tone and glyph on the viewer. */
function SlotBlock({
  slot,
  current,
  look,
}: {
  slot: PreviewModel['slots'][number];
  current: boolean;
  look: 'plate' | 'viewer';
}) {
  const Shot = look === 'viewer' && slot.shotType ? SHOT_GLYPHS[slot.shotType] : null;
  return (
    <span
      className={cn(
        'relative flex size-full items-center justify-center overflow-hidden rounded-clip border transition-colors duration-(--dur-micro) ease-(--ease-out)',
        look === 'viewer'
          ? cn(SHOT_TONES[slot.shotType ?? 'none'], current ? 'border-viewer-ink-2' : 'border-transparent')
          : current
            ? 'border-rule-strong bg-hover'
            : 'border-rule bg-raised',
      )}
    >
      {slot.role && slot.role !== 'body' ? (
        <span
          data-slot="role-mark"
          className={cn('absolute inset-x-0 top-0 h-[3px]', ROLE_KIND[slot.role].tone.mark)}
        />
      ) : null}
      {Shot ? <Shot className="size-3.5 shrink-0 text-viewer-ink-2" strokeWidth={1.75} /> : null}
    </span>
  );
}

export function StructureStrip({
  model,
  time,
  current,
  clock,
  loop,
  look = 'plate',
  className,
}: StructureStripProps) {
  const total = model.duration || 1;
  return (
    <div
      aria-hidden
      data-slot="structure-strip"
      data-look={look}
      className={cn('relative flex flex-col gap-1', className)}
    >
      <div className={cn('relative', look === 'viewer' ? 'h-10' : 'h-8')}>
        {model.slots.map((slot) => (
          <span
            key={slot.index}
            data-strip-slot={slot.index}
            data-current={current === slot.index || undefined}
            className="absolute top-0 bottom-0 px-px"
            style={{ left: `${(slot.start / total) * 100}%`, width: `${(slot.duration / total) * 100}%` }}
          >
            <SlotBlock slot={slot} current={current === slot.index} look={look} />
          </span>
        ))}
        {time !== null ? (
          <ClockPlayhead
            time={time}
            total={total}
            loop={loop ?? total}
            clock={clock}
            slot="structure-playhead"
            className="pointer-events-none absolute inset-y-[-2px] left-0 w-full"
          >
            <span className="absolute inset-y-0 right-0 w-0.5 translate-x-1/2 rounded-full bg-playhead" />
          </ClockPlayhead>
        ) : null}
      </div>
      {model.beats.length > 0 ? (
        <div className="relative h-1.5">
          {beatsToDraw(model.beats).map((beat, index) => (
            <span
              key={index}
              className="absolute top-0 bottom-0 w-px bg-beat"
              style={{ left: `${(beat / total) * 100}%` }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
