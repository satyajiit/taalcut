// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · component: onboarding, ways in · genre: atmospheric studio app (brand moment, quiet) · system: DESIGN.md v0.3
 * the ways a step offers (how it thinks, where the videos are) as hairline rows on the canvas, in the chat's opening
 *   choices' row voice (packages/ui opening-choices.tsx, main's quieter rows): a plain 16 px icon in ink-3 that
 *   darkens on hover, word, one line; no frame, no nudge. Choosing one opens its panel under it; the others
 *   stay one row each, so the person can change their mind. A way that already works says so on its row.
 * motion: Arrival for the opened panel (8 px rise and fade, 220 ms; reduced motion: fade); the chevron turns on
 *   transform. One primitive.
 * states (rows): default · hover (hover surface, ink) · focus (base ring, instant) · active (pressed surface) ·
 *   disabled (the reason replaces the line: offline, Local only) · loading (the row's own spinner, `busy`) · error
 *   (the panel's ErrorLine) · success (the check and the words on the row, announced by the panel)
 */
import { Chip, cn, Arrival } from '@taalcut/ui';
import { ChevronDown, CircleCheck, LoaderCircle } from 'lucide-react';
import { useId, type ReactNode } from 'react';

export interface Way<Id extends string> {
  readonly id: Id;
  readonly icon: ReactNode;
  /** The way's name: its row's words and its panel's accessible name. */
  readonly title: string;
  readonly line: ReactNode;
  /** "Recommended": the first way only. */
  readonly chip?: ReactNode;
  /** This way works already: what it is now ("Using ChatGPT plan"). */
  readonly done?: ReactNode;
  /** Why it can't be chosen now; replaces the line. */
  readonly unavailable?: ReactNode;
  readonly busy?: boolean;
  /** Its panel when open. */
  readonly panel: ReactNode;
}

export interface WayListProps<Id extends string> {
  readonly label: string;
  readonly ways: readonly Way<Id>[];
  readonly open: Id | null;
  onOpen(id: Id | null): void;
  /** Opened by a resume or a click: animate only what the person opened. */
  readonly animate?: boolean;
}

/** The ways in, as rows; the open one shows its panel under it. */
export function WayList<Id extends string>({ label, ways, open, onOpen, animate = true }: WayListProps<Id>) {
  const base = useId();
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col p-0">
      {ways.map((way) => {
        const isOpen = open === way.id;
        const panel = `${base}-${way.id}`;
        const off = way.unavailable !== undefined;
        return (
          <li key={way.id} data-way={way.id} className="border-t border-rule-subtle first:border-t-0">
            <button
              type="button"
              disabled={off}
              aria-expanded={isOpen}
              aria-controls={isOpen ? panel : undefined}
              aria-busy={way.busy || undefined}
              onClick={() => onOpen(isOpen ? null : way.id)}
              className={cn(
                'group flex w-full cursor-pointer items-start gap-3 rounded-md px-3 py-3 text-start',
                'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover active:bg-pressed',
                'disabled:cursor-not-allowed disabled:hover:bg-transparent',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-ink-3 [&_svg]:size-4',
                  'transition-colors duration-(--dur-micro) group-hover:text-ink-2 group-disabled:text-ink-disabled',
                )}
              >
                {way.icon}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-base font-medium text-ink group-disabled:text-ink-disabled">
                    {way.title}
                  </span>
                  {way.chip ? <Chip tone="primary">{way.chip}</Chip> : null}
                </span>
                <span className="text-sm text-ink-2">{off ? way.unavailable : way.line}</span>
                {way.done ? (
                  <span className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-ink">
                    <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
                    {way.done}
                  </span>
                ) : null}
              </span>
              {way.busy ? (
                <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-ink-2" />
              ) : (
                <ChevronDown
                  aria-hidden
                  className={cn(
                    'mt-0.5 size-4 shrink-0 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out)',
                    isOpen && 'rotate-180',
                  )}
                />
              )}
            </button>
            {isOpen ? (
              <Arrival animate={animate} className="ps-10 pe-3 pb-4">
                <div id={panel} role="region" aria-label={way.title}>
                  {way.panel}
                </div>
              </Arrival>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
