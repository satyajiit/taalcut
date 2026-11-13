// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: computer picker · mode: Persuade · system: WEB2 Remix Vernacular
 * states: default (raised pill, rule edge, ink-2 name) · hover (ink name, stronger edge) · focus (the base ring) ·
 *   active (2 % give) · chosen (teal field and a teal edge: your computer) · reduced motion (no give) · without
 *   JavaScript (16 GB Mac chosen). A radio group: one tab stop, arrow keys, Home and End.
 * Pick your computer: an 8 GB Mac, a 16 GB Mac, a 32 GB Mac, or Ubuntu, each by its SVGL icon beside its name. */

import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { BrandIcon } from '#components/brand/brand-icon';
import { AI_METER } from '#content/ai-map';
import { cn } from '#lib/cn';
import { DEVICE_RUNS, type DeviceId, stepDevice } from './model';

export function ComputerPicker({ value, onChange, labelId, action }: {
  readonly value: DeviceId;
  readonly onChange: (id: DeviceId) => void;
  readonly labelId: string;
  /** Beside the label: the meter's Fill again. */
  readonly action?: ReactNode;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = DEVICE_RUNS.findIndex((d) => d.id === value);
  const onKey = (e: KeyboardEvent) => {
    const focused = refs.current.findIndex((el) => el === document.activeElement);
    const next = stepDevice(focused >= 0 ? focused : index, e.key);
    if (next === null) return;
    e.preventDefault();
    onChange(DEVICE_RUNS[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span id={labelId} className="type-label font-semibold text-ink">
          {AI_METER.pick}
        </span>
        {action}
      </div>
      <div role="radiogroup" aria-labelledby={labelId} onKeyDown={onKey} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DEVICE_RUNS.map((d, i) => {
          const chosen = d.id === value;
          return (
            <button
              key={d.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={chosen}
              tabIndex={chosen ? 0 : -1}
              data-device={d.id}
              onClick={() => onChange(d.id)}
              className={cn(
                'inline-flex h-12 min-w-0 items-center justify-center gap-2 rounded-pill px-4 type-site-body font-semibold whitespace-nowrap select-none',
                'transition-[color,box-shadow,transform] duration-(--dur-micro) ease-(--ease-out) active:scale-[0.98] motion-reduce:active:scale-100',
                chosen ? 'bg-teal-soft text-ink ring-2 ring-teal-strong' : 'bg-raised text-ink-2 ring-1 ring-rule hover:text-ink hover:ring-rule-strong',
              )}
            >
              {/* The icon beside its name, as IconText pairs them (the brand rule reads data-slot="icon-text"). */}
              <span data-slot="icon-text" className="contents">
                <BrandIcon id={d.brand} className="size-5" />
                <span>{d.name}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
