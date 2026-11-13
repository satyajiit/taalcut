// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: pacing bands · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * one band per section of the energy curve over the beat lane: its height the energy (a rose wash with a rose top
 *   edge: rhythm is rose's one job, and the edge is a data mark, not a container stripe), its pacing in words
 *   ("Cut every 2 beats"; a narrower band "2 beats", the narrowest the number, so no band cuts its words short;
 *   the title and the slider's value always say it in full); the preview's new cuts as ghost ticks (neutral,
 *   dashed) across the lane
 * states: default · hover (the hover surface behind the band) · focus-visible (the base ring, inset so the bed's
 *   edge can't clip it) · active (dragging: the grabbing cursor, the energy follows the pointer) · selected (the
 *   selection wash, words in full ink) · disabled (read only: no drag, still a slider to read) · loading (ghost
 *   ticks wait for the preview) · error/success: the controls' line · each band is a role=slider: arrows 5 %,
 *   Page Up/Down 20 %, Home/End, S splits, M merges; the stepper beside is the drag's equal (WCAG 2.5.7)
 * motion: the ghost ticks fade in (opacity); dragging is direct · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { RationalTime, type EnergyCurve, type Template } from '@taalcut/core';
import { cn } from '@taalcut/ui';
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { mergeNext, middleSplit, sectionSlots, splitAt, withEnergy } from './energy-model';
import { bandName, bandValueText, pacingNumber, pacingShort, pacingWords } from './pacing-words';

export interface PacingBandsProps {
  readonly template: Template;
  readonly curve: EnergyCurve;
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  readonly onChange: (curve: EnergyCurve | null) => void;
  /** A frame at the template's rate, in pixels from the lane's start. */
  readonly px: (frame: number) => number;
  /** The preview's cuts (template frames); null while there is none. */
  readonly ghost: readonly number[] | null;
  readonly readOnly?: boolean;
  readonly className?: string;
}

const STEP = 0.05;
const PAGE = 0.2;

/** Where each band runs, in template frames. */
export function bandSpans(template: Template, curve: EnergyCurve) {
  const rate = template.canvas.rate;
  const frames = (time: RationalTime) => RationalTime.toFrames(time, rate);
  return sectionSlots(template, curve).map(({ from, to }) => {
    const first = template.slots[from];
    const last = template.slots[to];
    return {
      start: first ? frames(first.start) : 0,
      end: last ? frames(last.start) + frames(last.duration) : 0,
    };
  });
}

export function PacingBands({
  template,
  curve,
  selected,
  onSelect,
  onChange,
  px,
  ghost,
  readOnly = false,
  className,
}: PacingBandsProps) {
  const { t, i18n } = useLingui();
  const lane = useRef<HTMLDivElement>(null);
  const spans = bandSpans(template, curve);
  const count = curve.sections.length;

  const energyAt = (clientY: number) => {
    const box = lane.current?.getBoundingClientRect();
    if (!box || box.height === 0) return null;
    return 1 - (clientY - box.top) / box.height;
  };

  const onPointerDown = (index: number, event: PointerEvent<HTMLDivElement>) => {
    onSelect(index);
    if (readOnly || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const energy = energyAt(event.clientY);
    if (energy !== null) onChange(withEnergy(curve, index, energy));
  };
  const onPointerMove = (index: number, event: PointerEvent<HTMLDivElement>) => {
    if (readOnly || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const energy = energyAt(event.clientY);
    if (energy !== null) onChange(withEnergy(curve, index, energy));
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLDivElement>) => {
    const energy = curve.sections[index]?.energy ?? 0;
    const moves: Record<string, number> = {
      ArrowUp: energy + STEP,
      ArrowRight: energy + STEP,
      ArrowDown: energy - STEP,
      ArrowLeft: energy - STEP,
      PageUp: energy + PAGE,
      PageDown: energy - PAGE,
      Home: 0,
      End: 1,
    };
    const key = event.key;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (key in moves) {
      event.preventDefault();
      event.stopPropagation();
      if (!readOnly) onChange(withEnergy(curve, index, moves[key] ?? energy));
    } else if ((key === 's' || key === 'S') && !readOnly) {
      event.preventDefault();
      event.stopPropagation();
      const after = middleSplit(template, curve, index);
      if (after !== null) onChange(splitAt(template, curve, index, after));
    } else if ((key === 'm' || key === 'M') && !readOnly) {
      event.preventDefault();
      event.stopPropagation();
      onChange(mergeNext(curve, index));
    }
  };

  return (
    <div
      ref={lane}
      role="group"
      aria-label={t`Pacing`}
      data-slot="pacing-bands"
      className={cn('relative h-16', className)}
    >
      {curve.sections.map((section, index) => {
        const span = spans[index] ?? { start: 0, end: 0 };
        const left = px(span.start);
        const width = Math.max(4, px(span.end) - left - 1);
        const isSelected = index === selected;
        const words = pacingWords(i18n, section.beatsPerClip);
        return (
          <div
            key={`${section.fromSlotId}:${section.toSlotId}`}
            role="slider"
            tabIndex={0}
            aria-label={bandName(i18n, index, count)}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(section.energy * 100)}
            aria-valuetext={bandValueText(i18n, section.energy, section.beatsPerClip)}
            aria-readonly={readOnly || undefined}
            aria-keyshortcuts={readOnly ? undefined : 'S M'}
            data-slot="pacing-band"
            data-selected={isSelected || undefined}
            title={words}
            className={cn(
              'group @container absolute inset-y-0 overflow-hidden rounded-sm transition-colors duration-(--dur-micro) ease-(--ease-out)',
              '-outline-offset-2 hover:bg-hover',
              isSelected && 'bg-selected hover:bg-selected',
              readOnly ? 'cursor-default' : 'cursor-ns-resize active:cursor-grabbing',
            )}
            style={{ left, width }}
            onPointerDown={(event) => onPointerDown(index, event)}
            onPointerMove={(event) => onPointerMove(index, event)}
            onFocus={() => {
              if (!isSelected) onSelect(index);
            }}
            onKeyDown={(event) => onKeyDown(index, event)}
          >
            <span
              aria-hidden
              className="absolute inset-0 origin-bottom bg-beat-soft"
              style={{ transform: `scaleY(${section.energy})` }}
            />
            <span
              aria-hidden
              data-slot="pacing-edge"
              className="absolute inset-x-0 bottom-0 h-0.5 rounded-pill bg-beat-strong"
              style={{ transform: `translateY(calc(${-section.energy} * (4rem - 2px)))` }}
            />
            <span
              aria-hidden
              className={cn(
                'relative block px-1.5 pt-1 text-2xs font-medium whitespace-nowrap',
                isSelected ? 'text-ink' : 'text-ink-2',
              )}
            >
              {/* Wide, narrower, narrowest: sized for the longest translations, not just the English. */}
              <span className="hidden @min-[10rem]:inline">{words}</span>
              <span className="hidden @min-[5rem]:inline @min-[10rem]:hidden">
                {pacingShort(i18n, section.beatsPerClip)}
              </span>
              <span className="tabular-nums @min-[5rem]:hidden">
                {pacingNumber(i18n, section.beatsPerClip)}
              </span>
            </span>
          </div>
        );
      })}
      {ghost
        ? ghost
            .slice(1, -1)
            .map((frame) => (
              <span
                key={frame}
                aria-hidden
                data-slot="ghost-cut"
                className="pointer-events-none absolute inset-y-0 w-0 border-l border-dashed border-ink-2 motion-safe:animate-fade-in"
                style={{ left: px(frame) }}
              />
            ))
        : null}
    </div>
  );
}
