// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a colour adjustment's slider (MORE1) · system: DESIGN.md v0.7
 * one of the colour sheet's three adjustments: its name, its value in words beside it ("A little brighter",
 *   never a bare number), and a slider that rests in the middle, where the picture is as shot (a mark shows the
 *   place, and the fill runs from that mark to the thumb, either way). It saves once, when the hand lets go or a key moves it; while it moves, `onDraft` lets the swatches
 *   follow
 * states: default · hover · focus (the base ring) · active (dragging: the words follow) · disabled (a locked
 *   scene or the AI editing: the reason is the sheet's) · a save on its way (it keeps working: each release or
 *   key is its own edit) · refused (it goes back to the saved value; the sheet says why) · motion: none
 */
import { cn } from '@taalcut/ui';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';

export interface GradeSliderProps {
  label: string;
  value: number;
  /** The value in words. */
  words(value: number): string;
  disabled?: boolean;
  /** Counts the saves that were refused: the slider goes back to `value` when it changes. */
  version?: number;
  /** While the slider moves, before it is saved. */
  onDraft?(value: number): void;
  onCommit(value: number): void;
  slot: string;
}

/**
 * Where the fill starts and how far it runs, as shares of the thumb's travel (the thumb is 16 px wide and stays
 * inside the track, so its middle travels the track less those 16 px): the classes below turn them into lengths.
 */
function fillOf(value: number): CSSProperties {
  const share = (value + 1) / 2;
  return { '--fill-from': Math.min(share, 0.5), '--fill-span': Math.abs(share - 0.5) } as CSSProperties;
}

export function GradeSlider({
  label,
  value,
  words,
  disabled,
  version = 0,
  onDraft,
  onCommit,
  slot,
}: GradeSliderProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => setDraft(value), [value, version]);
  // The native change event fires when a drag ends or a key moves it: one save per gesture. The slider stays
  // enabled while a save is on its way, so a key held down keeps its focus and each step is its own edit.
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const changed = () => commit.current(Number(input.value));
    input.addEventListener('change', changed);
    return () => input.removeEventListener('change', changed);
  }, []);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <label htmlFor={id} className={cn('type-label', disabled ? 'text-ink-2' : 'text-ink')}>
          {label}
        </label>
        <span data-slot="grade-slider-value" className="type-meta text-ink-2">
          {words(draft)}
        </span>
      </div>
      <div className="relative flex h-6 items-center">
        {/* The track, where the picture is as shot (the middle), and how far from it the slider stands. */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 h-1 rounded-pill bg-rule" />
        <span
          aria-hidden
          data-slot="grade-slider-fill"
          className={cn(
            'pointer-events-none absolute h-1 rounded-pill',
            'left-[calc(0.5rem+var(--fill-from)*(100%-1rem))] w-[calc(var(--fill-span)*(100%-1rem))]',
            disabled ? 'bg-rule-strong' : 'bg-primary-strong',
          )}
          style={fillOf(draft)}
        />
        <span aria-hidden className="pointer-events-none absolute left-1/2 h-2.5 w-px bg-rule-strong" />
        <input
          ref={ref}
          id={id}
          type="range"
          data-slot={slot}
          min={-1}
          max={1}
          step={0.1}
          value={draft}
          disabled={disabled}
          aria-valuetext={words(draft)}
          onChange={(event) => {
            const next = Number(event.target.value);
            setDraft(next);
            onDraft?.(next);
          }}
          className={cn(
            'relative h-6 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed',
            '[&::-webkit-slider-runnable-track]:h-6 [&::-webkit-slider-runnable-track]:bg-transparent',
            '[&::-webkit-slider-thumb]:mt-1 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none',
            '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2',
            '[&::-webkit-slider-thumb]:border-raised [&::-webkit-slider-thumb]:bg-primary-strong',
            '[&::-webkit-slider-thumb]:shadow-xs disabled:[&::-webkit-slider-thumb]:bg-rule-strong',
          )}
        />
      </div>
    </div>
  );
}
