// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: choice cards (MORE1) · system: DESIGN.md v0.7
 * a value picked by eye from a few drawn cards (a speed, a transition, a colour look): each card is its picture
 *   over its name. One is chosen; picking another sends the change at once, so the viewer shows it
 * keys: one tab stop. ←/→ (↑/↓), Home and End move between the cards without choosing; Return or Space chooses
 *   the card in focus, so walking the row never sends an edit per step
 * states: default (raised, the rule hairline) · hover (a stronger edge and a little lift) · focus (the base
 *   ring) · active (pressed, gives 2 %) · chosen (a marigold edge and an ink tick: never colour alone) · busy (the
 *   card just picked spins until the edit lands; the others wait) · off (the whole group reads but does not act;
 *   the caller says why beside it)
 * motion: the tick draws in (the kit's Tick); reduced motion: it fades in
 */
import { cn, PRESS_CONTROL, Tick } from '@taalcut/ui';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface ChoiceCard<T extends string> {
  value: T;
  label: string;
  /** A second line under the label, part of the card's name (where a size is posted). */
  detail?: string;
  /** A word beside the label for the one card it is true of ("Now"). */
  badge?: string | undefined;
  /** The choice drawn: a figure, a motif or a swatch. Decoration: the label names it. */
  picture: ReactNode;
}

export interface ChoiceCardsProps<T extends string> {
  /** The group's name ("Speed"). */
  label: string;
  /** `data-slot`, for tests. */
  slot: string;
  value: T;
  options: readonly ChoiceCard<T>[];
  /** The value an edit on its way will set. */
  sending?: T | null;
  /** The group reads but does not act. */
  off?: boolean;
  /** The id of the line that says why it is off, or what a choice does. */
  describedBy?: string | undefined;
  /** The cards are one row that scrolls sideways where the panel is narrow (`data-scroll-x`: meant to). */
  sideways?: boolean;
  className?: string;
  onPick(value: T): void;
}

export function ChoiceCards<T extends string>({
  label,
  slot,
  value,
  options,
  sending = null,
  off = false,
  describedBy,
  sideways = false,
  className,
  onPick,
}: ChoiceCardsProps<T>) {
  const cards = useRef<Array<HTMLButtonElement | null>>([]);
  // The tick draws itself in for a choice just made, never for the one that was there when the cards arrived.
  const arrived = useRef(false);
  useEffect(() => {
    arrived.current = true;
  }, []);
  // One tab stop: the chosen card, or the first when the value is none of them (a speed the AI set).
  const focusable = options.some((option) => option.value === value) ? value : options[0]?.value;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const at = cards.current.findIndex((card) => card === document.activeElement);
    const last = options.length - 1;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? Math.min(last, at + 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? Math.max(0, at - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null || at < 0) return;
    event.preventDefault();
    cards.current[next]?.focus();
  };
  const waiting = sending !== null;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      aria-disabled={off || undefined}
      aria-busy={waiting || undefined}
      data-slot={slot}
      data-value={value}
      data-scroll-x={sideways ? '' : undefined}
      onKeyDown={onKeyDown}
      className={cn('grid gap-2', className)}
    >
      {options.map((option, index) => {
        const chosen = option.value === value;
        const spinning = sending === option.value;
        const still = off || (waiting && !spinning);
        return (
          <button
            key={option.value}
            ref={(card) => {
              cards.current[index] = card;
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-disabled={still || undefined}
            data-value={option.value}
            tabIndex={option.value === focusable ? 0 : -1}
            onClick={() => {
              if (!off && !waiting && !chosen) onPick(option.value);
            }}
            className={cn(
              'relative flex min-w-0 flex-col items-center gap-1.5 rounded-lg border bg-raised p-2 text-center',
              PRESS_CONTROL,
              chosen
                ? 'border-primary-strong shadow-[inset_0_0_0_1px_var(--color-primary-strong)]'
                : 'border-rule shadow-xs',
              still
                ? 'cursor-not-allowed active:scale-100'
                : cn(
                    'cursor-pointer active:bg-pressed',
                    !chosen && 'hover:border-rule-strong hover:shadow-sm',
                  ),
              off && 'text-ink-disabled shadow-none',
            )}
          >
            <span aria-hidden className={cn('flex w-full items-center justify-center', off && 'opacity-55')}>
              {option.picture}
            </span>
            {option.detail === undefined ? (
              <span className={cn('type-meta break-words', chosen && !off ? 'text-ink' : 'text-ink-2')}>
                {option.label}
              </span>
            ) : (
              <span className="flex flex-col items-center gap-0.5">
                <span className="flex items-center gap-1.5 type-card-title text-ink tabular-nums">
                  {option.label}
                  {option.badge ? (
                    <span className="rounded-pill bg-chip px-1.5 type-caption text-ink-2">
                      {option.badge}
                    </span>
                  ) : null}
                </span>
                <span className="type-meta break-words text-ink-2">{option.detail}</span>
              </span>
            )}
            {chosen || spinning ? (
              <span
                aria-hidden
                data-slot="choice-mark"
                // Inside the card's corner: nothing hangs outside the card, so a row of them can scroll sideways.
                className="absolute end-1 top-1 inline-flex size-4 items-center justify-center rounded-full bg-inverse text-on-inverse ring-2 ring-raised"
              >
                {spinning ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  <Tick draw={arrived.current} className="size-3" />
                )}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
