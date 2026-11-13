// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: labelled switch · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the kit's Switch (components/switch.tsx: its eight states) with its words beside it; the words name it for
 *   screen readers and toggle it on click, with no generated id to tie them (renders stay stable in tests)
 * states: the Switch's · the words dim with it when disabled
 * pre-emit critique: P4 H4 E5 S4 R5 V3 */
import { cn } from '#lib/cn';
import { Switch } from '../components/switch';

export interface LabelledSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What it turns on, translated: it is also the switch's name. */
  children: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export function LabelledSwitch({
  checked,
  onChange,
  children,
  disabled = false,
  loading = false,
  className,
}: LabelledSwitchProps) {
  const off = disabled || loading;
  return (
    <span
      data-slot="labelled-switch"
      className={cn(
        'inline-flex items-center gap-2 text-sm',
        disabled ? 'text-ink-disabled' : 'text-ink',
        className,
      )}
    >
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        loading={loading}
        aria-label={children}
      />
      {/* The switch carries the name; the words are its larger click target. */}
      <span
        aria-hidden
        className={cn('select-none', off ? 'cursor-not-allowed' : 'cursor-pointer')}
        onClick={() => {
          if (!off) onChange(!checked);
        }}
      >
        {children}
      </span>
    </span>
  );
}
