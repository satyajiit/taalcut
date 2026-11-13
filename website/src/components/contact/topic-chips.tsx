// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: topic chips · the answers to the thread's question sticker, one topic at a time
 * mode: Persuade · system: WEB2 Remix Vernacular (a story question's answers as quick replies; picked is yours, so
 *   teal)
 * states: default (raised pill, rule edge, its icon) · hover (hover surface, ink-3 edge) · focus (base ring) · active
 *   (gives 3%) · checked (teal-strong face, a tick in place of the icon) · disabled: never (while the form is
 *   closed the chips still answer with the topic's mailbox) · arriving (after the question sticker lands)
 * An APG radio group: one tab stop (the picked chip, or the first), arrows move and pick, Home and End jump. The chips
 *   are buttons outside any field's `name`, so a send without JavaScript carries no topic. */

import { Bug, Hand, Newspaper, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';
import { motion, type Variants } from 'motion/react';
import { useRef, type KeyboardEvent } from 'react';
import { CONTACT_CHIPS, CONTACT_PAGE, type ContactChipId } from '#content/contact';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { Tick } from '#components/waitlist/form-parts';
import { chipAfterKey, isChipId } from './topics';

export const CHIP_ICONS: Readonly<Record<ContactChipId, LucideIcon>> = {
  hello: Hand,
  press: Newspaper,
  privacy: ShieldCheck,
  security: ShieldAlert,
  broken: Bug,
};

const CHIP =
  'inline-flex h-10 items-center gap-2 rounded-pill border px-4 type-label whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,scale] duration-(--dur-micro) ease-(--ease-out) ' +
  'active:scale-[0.97] motion-reduce:active:scale-100';
const OFF = 'border-rule bg-raised text-ink shadow-xs hover:border-ink-3 hover:bg-hover';
const ON = 'border-teal-strong bg-teal-strong text-teal-strong-ink shadow-sticker';

export function TopicChips({
  picked,
  onPick,
  itemVariants,
  className,
}: {
  readonly picked: ContactChipId | null;
  readonly onPick: (id: ContactChipId) => void;
  /** The thread's opening, so the chips pop in after the question sticker lands. */
  readonly itemVariants?: Variants;
  readonly className?: string;
}) {
  const refs = useRef<Partial<Record<ContactChipId, HTMLButtonElement | null>>>({});
  const tabStop = picked ?? CONTACT_CHIPS[0]?.id;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // From the chip that has focus: with nothing picked yet, that is the first, the group's one tab stop.
    const from = (event.target as HTMLElement).dataset.topic;
    const next = chipAfterKey(isChipId(from) ? from : picked, event.key);
    if (!next) return;
    event.preventDefault();
    onPick(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={CONTACT_PAGE.thread.topics}
      onKeyDown={onKeyDown}
      className={cn('flex flex-wrap gap-2', className)}
      data-slot="topic-chips"
    >
      {CONTACT_CHIPS.map((chip) => {
        const on = chip.id === picked;
        const Icon = CHIP_ICONS[chip.id];
        return (
          <motion.span key={chip.id} variants={itemVariants} className="inline-flex">
            <button
              ref={(el) => {
                refs.current[chip.id] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={chip.id === tabStop ? 0 : -1}
              data-topic={chip.id}
              onClick={() => onPick(chip.id)}
              className={cn(CHIP, on ? ON : OFF)}
            >
              {on ? (
                <Tick size={16} strokeWidth={2.5} />
              ) : (
                <Icon aria-hidden strokeWidth={ICON_STROKE} className="size-4 shrink-0 text-ink-2" />
              )}
              {chip.label}
            </button>
          </motion.span>
        );
      })}
    </div>
  );
}
