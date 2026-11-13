// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: question sticker · the thread's opening: Taalcut asks with a Stories question sticker, and the topic
 *   chips are its answers
 * mode: Persuade · system: WEB2 Remix Vernacular (the Stories question sticker: the asker's avatar on its top edge,
 *   the question in the heavy display on a pink field, the answers under it on the paper; tilted a few degrees, it
 *   pops and settles when Taalcut sends it)
 * states: resting (the server HTML, reduced motion: tilted and still) · waiting (the opening, before Taalcut sends it:
 *   hidden by a class, never an inline style in the server HTML) · arriving (pops from 60 % and settles on a spring,
 *   then its answers pop in one after another) · the chips' own states (topic-chips.tsx). Not a control itself: the
 *   chips are. */

import { motion, type Variants } from 'motion/react';
import { Logo } from '#components/brand/logo';
import { CONTACT_PAGE, type ContactChipId } from '#content/contact';
import { cn } from '#lib/cn';
import { POP } from '#lib/motion';
import { TopicChips } from './topic-chips';
import { INTRO_WAITING } from './use-thread-intro';

/** The sticker's lean, in degrees: a few, as a sticker sits on a story. */
const TILT = -2;

const STICKER: Variants = {
  hidden: { opacity: 0, scale: POP.scale, rotate: TILT - POP.turn, transition: { duration: 0 } },
  shown: { opacity: 1, scale: 1, rotate: TILT, transition: POP.spring },
};

/** An answer: hidden by React's own class while it waits, popping in when its step comes. */
const ANSWER: Variants = {
  hidden: { opacity: 0, scale: 0.86, y: 10, transition: { duration: 0 } },
  shown: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 520, damping: 30, mass: 0.7 },
  },
};
const ANSWERS: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.06 } } };

export function QuestionSticker({
  shown,
  answersShown,
  picked,
  onPick,
}: {
  /** Whether the opening has sent the sticker (always, outside the opening). */
  readonly shown: boolean;
  /** Whether its answers have popped in. */
  readonly answersShown: boolean;
  readonly picked: ContactChipId | null;
  readonly onPick: (id: ContactChipId) => void;
}) {
  return (
    <motion.div
      data-slot="question"
      initial={false}
      animate={shown ? 'shown' : 'hidden'}
      variants={STICKER}
      className={cn(
        'relative mx-auto mt-8 mb-2 w-full max-w-[26rem] rounded-[1.75rem] bg-sticker-paper text-sticker-paper-ink shadow-sticker ring-1 ring-rule-subtle',
        !shown && 'opacity-0',
        INTRO_WAITING,
      )}
    >
      {/* Who asks: Taalcut's mark on the sticker's top edge, in a die-cut ring, as a story's question shows its asker. */}
      <span
        aria-hidden
        className="absolute -top-8 left-1/2 grid size-16 -translate-x-1/2 place-items-center rounded-full border-4 border-sticker-cut bg-canvas shadow-sticker"
      >
        <Logo kind="symbol" colourway="four-colour" className="size-9" />
      </span>
      <p className="m-0 rounded-t-[1.75rem] bg-sticker-pink px-6 pt-10 pb-4 text-center type-site-subhead font-extrabold tracking-[-0.03em] text-balance text-sticker-pink-ink">
        {CONTACT_PAGE.thread.question}
      </p>
      <div className="flex flex-col gap-2.5 px-3 pt-3 pb-4 sm:px-4">
        <p className="m-0 text-center type-meta text-ink-2">{CONTACT_PAGE.thread.hint}</p>
        <motion.div
          initial={false}
          animate={answersShown ? 'shown' : 'hidden'}
          variants={ANSWERS}
          className={cn(!answersShown && 'opacity-0', INTRO_WAITING)}
        >
          <TopicChips picked={picked} onPick={onPick} itemVariants={ANSWER} className="justify-center" />
        </motion.div>
      </div>
    </motion.div>
  );
}
