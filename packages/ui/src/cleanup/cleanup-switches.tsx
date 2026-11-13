// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cleanup switches · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * what a cleanup takes out, one labelled switch each: fillers, long pauses ("Shorten pauses longer than 0.5s",
 *   with its 0.2–2 s slider in the editor's panel), retakes, punch-ins; unboxed, a plain column
 * states: the kit Switch's eight (default, hover, focus-visible, active, disabled while a plan is applied,
 *   loading on the switch that is re-planning, error/success: the panel's line) · the slider: default, hover,
 *   focus-visible (the base ring), active (dragging), disabled with the pauses switch off · pre-emit critique: P4 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { CleanupSettings } from '@taalcut/core';
import { useId } from 'react';
import { cn } from '#lib/cn';
import { LabelledSwitch } from '../make/switch';

export type CleanupSwitchState = Pick<
  CleanupSettings,
  'fillers' | 'pauses' | 'retakes' | 'punchIns' | 'pauseThresholdMs'
>;

export interface CleanupSwitchesProps {
  readonly value: CleanupSwitchState;
  readonly onChange: (next: CleanupSwitchState) => void;
  /** The switch whose change is being planned. */
  readonly loading?: keyof CleanupSwitchState | null;
  readonly disabled?: boolean;
  /** The pause slider (the editor's panel; the card has the switches only). */
  readonly threshold?: boolean;
  readonly className?: string;
}

export const PAUSE_RANGE = { min: 200, max: 2000, step: 100 } as const;

export function CleanupSwitches({
  value,
  onChange,
  loading = null,
  disabled = false,
  threshold = false,
  className,
}: CleanupSwitchesProps) {
  const { t, i18n } = useLingui();
  const id = useId();
  const seconds = (ms: number) =>
    new Intl.NumberFormat(i18n.locale === 'en-XA' ? 'en' : i18n.locale, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'narrow',
      maximumFractionDigits: 1,
    }).format(ms / 1000);
  const longer = seconds(value.pauseThresholdMs);
  const set = <K extends keyof CleanupSwitchState>(key: K, next: CleanupSwitchState[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <div data-slot="cleanup-switches" className={cn('flex flex-col gap-2.5', className)}>
      <LabelledSwitch
        checked={value.fillers}
        onChange={(next) => set('fillers', next)}
        disabled={disabled}
        loading={loading === 'fillers'}
      >
        {t`Remove fillers (um, uh)`}
      </LabelledSwitch>
      <LabelledSwitch
        checked={value.pauses}
        onChange={(next) => set('pauses', next)}
        disabled={disabled}
        loading={loading === 'pauses'}
      >
        {t`Shorten pauses longer than ${longer}`}
      </LabelledSwitch>
      {threshold ? (
        <div className="flex flex-col gap-1 pl-11">
          <label htmlFor={id} className="text-xs text-ink-2">
            {t`Longest pause to keep`}
          </label>
          <input
            id={id}
            type="range"
            min={PAUSE_RANGE.min}
            max={PAUSE_RANGE.max}
            step={PAUSE_RANGE.step}
            value={value.pauseThresholdMs}
            disabled={disabled || !value.pauses}
            aria-valuetext={longer}
            data-slot="cleanup-pause-threshold"
            onChange={(event) => set('pauseThresholdMs', Number(event.target.value))}
            className="h-6 w-full max-w-64 cursor-pointer accent-primary-strong disabled:cursor-not-allowed"
          />
        </div>
      ) : null}
      <LabelledSwitch
        checked={value.retakes}
        onChange={(next) => set('retakes', next)}
        disabled={disabled}
        loading={loading === 'retakes'}
      >
        {t`Cut retakes (keep the last take)`}
      </LabelledSwitch>
      <LabelledSwitch
        checked={value.punchIns}
        onChange={(next) => set('punchIns', next)}
        disabled={disabled}
        loading={loading === 'punchIns'}
      >
        {t`Punch in on stressed words`}
      </LabelledSwitch>
    </div>
  );
}
