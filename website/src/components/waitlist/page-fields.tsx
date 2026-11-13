// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the waitlist page's extra fields · platforms (checkbox chips) and "What do you make?" (an optional select)
 * mode: Persuade · system: WEB2 Remix Vernacular (each platform a chip with its SVGL icon and its name in words; a
 *   picked chip is yours, so teal; never marigold)
 * states: default (raised chip, rule edge; nothing ticked unless the address names a platform) · hover (hover
 *   surface, edge ink-3) · focus (the base ring around the whole chip: the checkbox is the chip) · active (gives 3%)
 *   · checked (teal-soft face, teal-strong edge, the tick drawn in its circle) · disabled (sunken, ink-disabled; the
 *   closed state)
 * No field has a `name`: without JavaScript a native submit carries nothing.
 * reduced motion: the tick is whole and fades; the chip doesn't give */

import { useId } from 'react';
import { BrandIcon, type BrandIconId } from '#components/brand/brand-icon';
import type { PlatformId } from '#content/schema';
import { cn } from '#lib/cn';
import { MAKES, useWaitlistStore, type Make } from '#stores/waitlist';
import { FieldLabel, SELECT, SelectChevron } from './form-parts';
import { MAKE_LABELS, PLATFORM_CHOICES, WAITLIST_WORDS } from '#content/forms';

const BRANDS: Readonly<Record<PlatformId, BrandIconId>> = { macos: 'apple', ubuntu: 'ubuntu', windows: 'windows' };

/** The checkbox is the chip: it covers it, so the chip is the target and its focus ring is the chip's. */
const BOX =
  'peer absolute inset-0 size-full cursor-pointer appearance-none rounded-2xl border border-rule bg-raised shadow-xs ' +
  'transition-[background-color,border-color,scale] duration-(--dur-micro) ease-(--ease-out) ' +
  'hover:border-ink-3 hover:bg-hover checked:border-teal-strong checked:bg-teal-soft checked:hover:bg-teal-soft ' +
  'active:scale-[0.97] motion-reduce:active:scale-100 ' +
  'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-sunken disabled:shadow-none';

/** The tick's circle: an empty ring, filled teal with the tick drawn in once the chip is picked. */
const RING =
  'pointer-events-none relative grid size-5 shrink-0 place-items-center rounded-full border border-rule-strong ' +
  'transition-[background-color,border-color] duration-(--dur-short) ease-(--ease-out) ' +
  'peer-checked:border-teal-strong peer-checked:bg-teal-strong peer-checked:[--tick:0] [--tick:1]';
const TICK_PATH =
  '[stroke-dasharray:1] [stroke-dashoffset:var(--tick)] transition-[stroke-dashoffset] duration-(--dur-short) ease-(--ease-out)';

/** The computers someone will use. The form holds the choice: none until they pick one, or the address names one. */
export function PlatformChoices({
  picked,
  onToggle,
  disabled = false,
}: {
  readonly picked: readonly PlatformId[];
  readonly onToggle: (id: PlatformId) => void;
  readonly disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
      aria-describedby={`${id}-hint`}
      disabled={disabled}
    >
      <legend className="p-0 type-label text-ink">{WAITLIST_WORDS.platformsLegend}</legend>
      <p id={`${id}-hint`} className="m-0 type-meta text-ink-2">
        {WAITLIST_WORDS.platformsHint}
      </p>
      <div className="mt-1 grid grid-cols-1 gap-2 min-[30rem]:grid-cols-3">
        {PLATFORM_CHOICES.map((choice) => (
          <label key={choice.id} data-slot="icon-text" className="relative flex min-h-16 items-center gap-3 px-3.5 py-3" data-platform={choice.id}>
            <input
              type="checkbox"
              value={choice.id}
              checked={picked.includes(choice.id)}
              onChange={() => onToggle(choice.id)}
              aria-describedby={`${id}-${choice.id}`}
              className={BOX}
            />
            <span aria-hidden className={RING}>
              <svg
                viewBox="0 0 24 24"
                className="size-3.5 text-teal-strong-ink"
                fill="none"
                stroke="currentColor"
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m4 12 5 5L20 6" pathLength={1} className={TICK_PATH} />
              </svg>
            </span>
            <BrandIcon id={BRANDS[choice.id]} className={cn('pointer-events-none relative size-6', disabled && 'opacity-50')} />
            <span className="pointer-events-none relative flex min-w-0 flex-col">
              <span className={cn('type-label font-semibold', disabled ? 'text-ink-disabled' : 'text-ink')}>{choice.name}</span>
              <span id={`${id}-${choice.id}`} className={cn('type-meta', disabled ? 'text-ink-disabled' : 'text-ink-2')}>
                {choice.line}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function MakeSelect({ disabled = false }: { readonly disabled?: boolean }) {
  const id = useId();
  const make = useWaitlistStore((s) => s.make);
  const setMake = useWaitlistStore((s) => s.setMake);
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={`${id}-make`} note={WAITLIST_WORDS.makeOptional}>
        {WAITLIST_WORDS.makeLabel}
      </FieldLabel>
      <div className="relative">
        <select
          id={`${id}-make`}
          value={make ?? ''}
          disabled={disabled}
          onChange={(e) =>
            setMake((MAKES as readonly string[]).includes(e.target.value) ? (e.target.value as Make) : null)
          }
          className={SELECT}
        >
          <option value="">{WAITLIST_WORDS.makeNone}</option>
          {MAKES.map((m) => (
            <option key={m} value={m}>
              {MAKE_LABELS[m]}
            </option>
          ))}
        </select>
        <SelectChevron />
      </div>
    </div>
  );
}
