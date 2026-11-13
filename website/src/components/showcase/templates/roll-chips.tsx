// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the camera rolls, as Stories highlights · mode: Operate · system: WEB2 Remix Vernacular (teal is yours:
 *   the chosen roll's ring; the empty roll is dashed)
 * which camera roll fills the template: a round cover cut from the roll's own footage with its name under it, the
 *   way a profile's highlights sit; the last, dashed with a plus, is the trip you haven't been on yet. A radio group:
 *   Tab reaches the chosen one, the arrows move and choose, Home and End jump; choosing the chosen one again fills it
 *   again
 * states: default (a rule-strong ring) · hover (the ring in ink, the cover leans in 3 %) · focus (the base ring on the
 *   cover) · active (a 4 % give) · chosen (a teal ring with a gap, the name in ink, aria-checked) · the empty roll
 *   (dashed, the plus) · disabled/loading/error: n/a
 * motion: hover and press only (transform), none under reduced motion */

import { Plus } from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { spriteStyle } from '../frames';
import { type Roll, type RollId, stillOf } from './template';

export interface RollChipsProps {
  readonly rolls: readonly Roll[];
  readonly value: RollId;
  readonly onChoose: (id: RollId) => void;
  /** Where each roll's cover is, for its clips' flights. */
  readonly coverRef?: (id: RollId) => (el: HTMLSpanElement | null) => void;
  readonly size?: 'md' | 'sm';
  readonly className?: string;
}

export function RollChips({ rolls, value, onChoose, coverRef, size = 'md', className }: RollChipsProps) {
  const list = useRef<HTMLDivElement>(null);
  const choose = (id: RollId) => {
    onChoose(id);
    list.current?.querySelector<HTMLElement>(`[data-roll="${id}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = rolls.findIndex((r) => r.id === value);
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    let target: Roll | undefined;
    if (step !== 0) target = rolls[(at + step + rolls.length) % rolls.length];
    else if (event.key === 'Home') target = rolls[0];
    else if (event.key === 'End') target = rolls.at(-1);
    if (!target) return;
    event.preventDefault();
    choose(target.id);
  };
  const cover = size === 'md' ? 'size-15' : 'size-12';
  return (
    <div
      ref={list}
      role="radiogroup"
      aria-label="Fill the template from"
      onKeyDown={onKeyDown}
      className={cn('flex flex-row flex-wrap items-start gap-2', className)}
    >
      {rolls.map((roll) => {
        const checked = roll.id === value;
        const still = stillOf(roll.cover);
        return (
          <button
            key={roll.id}
            type="button"
            role="radio"
            aria-checked={checked}
            data-roll={roll.id}
            tabIndex={checked ? 0 : -1}
            onClick={() => choose(roll.id)}
            className="group flex w-20 flex-col items-center gap-1.5 rounded-xl p-1 text-center outline-offset-2 select-none"
          >
            <span
              className={cn(
                'relative inline-grid shrink-0 place-items-center rounded-pill p-[3px] transition-transform duration-(--dur-micro) ease-(--ease-out) group-active:scale-[0.96] motion-reduce:transition-none motion-reduce:group-active:scale-100',
                cover,
                still === undefined
                  ? 'border-[1.5px] border-dashed border-rule-strong'
                  : checked
                    ? 'border-2 border-teal-strong'
                    : 'border-2 border-rule-strong group-hover:border-ink',
              )}
            >
              <span
                ref={coverRef?.(roll.id)}
                className="relative block size-full overflow-hidden rounded-pill bg-sunken"
              >
                {still === undefined ? (
                  <span
                    aria-hidden
                    className="absolute inset-0 grid place-items-center text-ink-2 group-hover:text-ink"
                  >
                    <Plus strokeWidth={ICON_STROKE} className="size-5" />
                  </span>
                ) : (
                  <span
                    aria-hidden
                    data-frame="footage"
                    className="absolute inset-x-0 top-1/2 block aspect-[9/16] -translate-y-1/2 transition-transform duration-(--dur-short) ease-(--ease-out) group-hover:scale-[1.03] motion-reduce:transition-none"
                    style={spriteStyle(still)}
                  />
                )}
              </span>
            </span>
            <span
              className={cn(
                'type-label-sm leading-tight text-balance',
                checked ? 'text-ink' : 'text-ink-2 group-hover:text-ink',
              )}
            >
              {roll.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
