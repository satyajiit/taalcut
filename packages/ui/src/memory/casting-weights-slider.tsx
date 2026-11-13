// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: casting weight slider (LRN1-PREF) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 "AI versus you" · one score part in the casting editor's grid: its name, a native range
 *   inside the part's reach (core's bounds, less what the other four must keep; the rules' `reach`), its share as a percent with
 *   "default N%" after it and a tick at the default. What Taalcut learned is violet with the AI mark; a part you
 *   moved turns teal with the person mark, so the meaning survives greyscale
 * states: default · hover (the native thumb's) · focus-visible (base ring) · active (dragging) · disabled (Save on
 *   its way: dimmed, not-allowed) · loading/error/success (the editor's)
 * keys: arrows move a whole percent, Page Up/Down five, Home and End to the ends of the reach
 * motion: none
 */
import { useLingui } from '@lingui/react/macro';
import type { CastingWeightBound, CastingWeightKey } from '@taalcut/core';
import { UserRound } from 'lucide-react';
import { useId, type KeyboardEvent } from 'react';
import { AiMark } from '../components/ai-mark';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { CASTING_PART_LABELS } from './casting-weights-words';

const STEP = 0.01;
const PAGE = 0.05;
const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: STEP,
  ArrowUp: STEP,
  ArrowLeft: -STEP,
  ArrowDown: -STEP,
  PageUp: PAGE,
  PageDown: -PAGE,
};

export interface CastingWeightSliderProps {
  readonly part: CastingWeightKey;
  readonly value: number;
  /** The casting config's own weight for this part. */
  readonly fallback: number;
  readonly reach: CastingWeightBound;
  /** Stored steps per whole weight (thousandths): the slider's step and what a value rounds to. */
  readonly units: number;
  /** You moved it (teal); otherwise it is what Taalcut learned (violet). */
  readonly yours: boolean;
  readonly disabled: boolean;
  readonly autoFocus?: boolean;
  onChange(value: number): void;
}

export function CastingWeightSlider(props: CastingWeightSliderProps) {
  const { part, value, fallback, reach, units, yours, disabled, autoFocus = false, onChange } = props;
  const { i18n, t } = useLingui();
  const format = useFormatters();
  const id = useId();
  const shown = format.percent(value);
  const usual = format.percent(fallback);
  const set = (next: number) =>
    onChange(Math.round(Math.min(reach.max, Math.max(reach.min, next)) * units) / units);
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const ends: Readonly<Record<string, number>> = { Home: reach.min, End: reach.max };
    const end = ends[event.key];
    const step = KEY_STEPS[event.key];
    if (end === undefined && step === undefined) return;
    event.preventDefault();
    set(end ?? value + (step ?? 0));
  };
  return (
    <>
      <label htmlFor={id} className="type-label text-ink">
        {i18n._(CASTING_PART_LABELS[part])}
      </label>
      <input
        id={id}
        type="range"
        min={reach.min}
        max={reach.max}
        step={1 / units}
        value={value}
        list={`${id}-default`}
        disabled={disabled}
        // Adjust moves focus to the first part it opened.
        autoFocus={autoFocus}
        data-part={part}
        data-yours={yours}
        aria-valuetext={
          yours ? t`${shown}, set by you; default ${usual}` : t`${shown}, learned; default ${usual}`
        }
        onChange={(event) => set(Number(event.target.value))}
        onKeyDown={keyDown}
        className={cn(
          'h-6 w-full min-w-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
          yours ? 'accent-you-strong' : 'accent-ai-strong',
        )}
      />
      <datalist id={`${id}-default`}>
        <option value={fallback} />
      </datalist>
      <span className="flex items-center gap-1.5 type-body whitespace-nowrap tabular-nums" aria-hidden>
        {yours ? (
          <UserRound className="size-3.5 shrink-0 text-you-strong" />
        ) : (
          <AiMark className="size-3.5" />
        )}
        <span className="w-10 font-semibold text-ink">{shown}</span>
        <span className="text-ink-2">{t`default ${usual}`}</span>
      </span>
    </>
  );
}
