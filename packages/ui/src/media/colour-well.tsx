// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: colour well (HFW1-UI) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the system's own colour picker behind a 36 px well with the field's edge, the hex beside
 *   it as data; the colour is saved once the picker is closed (its change), not on every drag through it
 * states: default · hover (the edge to ink-3) · focus-visible (the base ring) · active · disabled (sunken) · loading
 *   (busy, the picker shut) · error (danger edge) · success (green edge until the next pick)
 * motion: none · pre-emit critique: P4 H4 E4 S4 R5 V4 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '#lib/cn';

export interface ColourWellProps {
  readonly id: string;
  /** `#rrggbb`. */
  readonly value: string;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly saved: boolean;
  readonly invalid: boolean;
  readonly describedBy?: string | undefined;
  readonly onPick: (colour: string) => void;
}

export function ColourWell({
  id,
  value,
  disabled,
  busy,
  saved,
  invalid,
  describedBy,
  onPick,
}: ColourWellProps) {
  const input = useRef<HTMLInputElement>(null);
  const [showing, setShowing] = useState(value);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => setShowing(value), [value]);
  // The picker reports every colour it passes through as `input`; `change` is the one the person chose.
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const changed = () => pick.current(element.value.toLowerCase());
    element.addEventListener('change', changed);
    return () => element.removeEventListener('change', changed);
  }, []);
  return (
    <span className="flex items-center gap-2">
      <input
        ref={input}
        id={id}
        type="color"
        value={showing}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        data-status={invalid ? 'error' : saved ? 'success' : undefined}
        className={cn(
          'h-9 w-12 shrink-0 cursor-pointer rounded-md border border-rule-strong bg-raised p-1 shadow-xs',
          'transition-[border-color] duration-(--dur-micro) ease-(--ease-out) hover:border-ink-3',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-sunken disabled:shadow-none',
          invalid && 'border-danger-strong',
          saved && !invalid && 'border-success-strong',
        )}
        onChange={(event) => setShowing(event.target.value)}
      />
      <span translate="no" className="type-data text-ink-2 uppercase tabular-nums">
        {showing}
      </span>
    </span>
  );
}
