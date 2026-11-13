// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: thread parts (bubble, typing bubble, receipt, the thread's header) · mode: Persuade
 * system: WEB2 Remix Vernacular (the direct message: Taalcut's bubbles on the bubble surface at the left, yours teal
 *   at the right, a tail corner on the last of a run)
 * states: bubble resting (server HTML and reduced motion) · popping (a bubble the thread adds grows from its corner
 *   on a spring, 150 ms fade under reduced motion) · typing (three dots bob, under a second, never under reduced
 *   motion) · receipt sending (spinner) · sent (tick draws in) · not sent (the cause and Try again: see the thread)
 * Not controls: links inside a bubble carry their own states. */

import { motion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import { Logo } from '#components/brand/logo';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { Kaatu, type KaatuMood, type KaatuPose } from '#components/kaatu/kaatu';
import { Tick, FORM_ICONS } from '#components/contact/form-parts';
import { CONTACT_PAGE } from '#content/contact';
import { cn } from '#lib/cn';
import { ICON_SIZE, ICON_STROKE, ICONS } from '#lib/icons';
import { REDUCED_FADE } from '#lib/motion';

export type Side = 'taalcut' | 'you';

const FACE: Readonly<Record<Side, string>> = {
  taalcut: 'self-start bg-bubble text-ink rounded-[1.375rem] rounded-bl-md origin-bottom-left',
  you: 'self-end bg-teal-strong text-teal-strong-ink rounded-[1.375rem] rounded-br-md origin-bottom-right',
};

/** A bubble the thread adds: it grows from its tail corner. Never used for a bubble in the server HTML. */
const POP: Variants = {
  hidden: { opacity: 0, scale: 0.86, y: 10 },
  shown: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 520, damping: 30, mass: 0.7 },
  },
};
const FADE: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: REDUCED_FADE } },
};

const BUBBLE_TEXT = 'type-site-body [overflow-wrap:anywhere]';
const BUBBLE_WIDTH = 'max-w-[85%] sm:max-w-[78%]';

/** One message. `pop`: the thread added it after the page loaded, so it grows in; a bubble from the server HTML sits still. */
export function Bubble({
  side,
  children,
  pop = false,
  className,
}: {
  readonly side: Side;
  readonly children: ReactNode;
  readonly pop?: boolean;
  readonly className?: string;
}) {
  const reduce = useReducedMotionPref();
  const own = pop ? (reduce ? FADE : POP) : undefined;
  return (
    <motion.div
      data-side={side}
      initial={own ? 'hidden' : false}
      animate={own ? 'shown' : undefined}
      variants={own}
      className={cn(BUBBLE_WIDTH, 'px-4 py-2.5', BUBBLE_TEXT, FACE[side], className)}
    >
      {children}
    </motion.div>
  );
}

/** Taalcut typing: three dots that bob for the moment before a reply. Decorative; the reply is what's announced. */
export function TypingBubble() {
  return (
    <motion.div
      aria-hidden
      data-slot="typing"
      initial="hidden"
      animate="shown"
      variants={POP}
      className={cn('flex h-11 items-center gap-1.5 px-4', FACE.taalcut)}
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-2 rounded-full bg-ink-3"
          animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.14, ease: 'easeInOut' }}
        />
      ))}
    </motion.div>
  );
}

/** The small line under your bubble: Sending…, Sent with its tick. */
export function Receipt({ sent, children }: { readonly sent: boolean; readonly children: ReactNode }) {
  const Spinner = FORM_ICONS.spinner;
  return (
    <p className="m-0 -mt-1 inline-flex items-center gap-1.5 self-end type-meta text-ink-2">
      {sent ? (
        <Tick size={ICON_SIZE.sm} strokeWidth={2.5} className="text-teal-strong" />
      ) : (
        <Spinner aria-hidden size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="animate-spin" />
      )}
      {children}
    </p>
  );
}

/**
 * The thread's header: Taalcut's mark with Kaatu at its shoulder (a two-person chat's paired avatars), the name, and
 * how replies come. Kaatu follows the form: it glances while you type, thinks while it sends, cheers when it's in.
 */
export function ThreadHeader({
  headingId,
  mood,
  pose,
}: {
  readonly headingId: string;
  readonly mood: KaatuMood;
  readonly pose?: KaatuPose;
}) {
  const Mail = ICONS.mail;
  return (
    <div className="flex items-center gap-4 rounded-t-window border-b border-rule-subtle bg-raised px-4 py-3 sm:px-5">
      <span aria-hidden className="relative inline-flex h-12 w-[4.75rem] shrink-0 items-center">
        <span className="grid size-12 place-items-center rounded-full bg-canvas shadow-sticker ring-1 ring-rule">
          <Logo kind="symbol" colourway="four-colour" className="size-7" />
        </span>
        <Kaatu
          mood={mood}
          pose={pose}
          size={64}
          follow
          sticker
          toward="left"
          className="absolute -end-2 -bottom-3"
        />
      </span>
      <div className="flex min-w-0 flex-col">
        <h2 id={headingId} className="m-0 type-site-subhead text-ink">
          <span className="sr-only">Message </span>
          {CONTACT_PAGE.thread.name}
        </h2>
        <p className="m-0 inline-flex items-center gap-1.5 type-meta text-ink-2">
          <Mail
            aria-hidden
            size={ICON_SIZE.sm}
            strokeWidth={ICON_STROKE}
            className="shrink-0 text-teal-strong"
          />
          {CONTACT_PAGE.thread.status}
        </p>
      </div>
    </div>
  );
}
