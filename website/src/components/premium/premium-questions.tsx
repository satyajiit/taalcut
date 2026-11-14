// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Premium questions · /premium/'s short FAQ, before the order form
 * mode: Read · system: WEB2 Remix Vernacular (the home page's questions: an accordion of native <details>)
 * states: a question: closed (default; without JavaScript, the browser's own <details>) · open (the answer rises in;
 *   at once under reduced motion; the chevron turns) · hover (surface) · focus (base ring on the summary) · active
 *   (pressed surface) · keyboard: Tab to a question, Enter or Space opens and closes it (the browser's own)
 * The questions are content/premium.ts's, word for word; the first is the site FAQ's own "Is Taalcut still free?". */

import { ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { Arrive, Section } from '#components/ui/section';
import { PREMIUM_PAGE, PREMIUM_QUESTIONS } from '#content/premium';
import { ICON_STROKE } from '#lib/icons';
import { EASE_OUT } from '#lib/motion';

function Question({ entry }: { readonly entry: (typeof PREMIUM_QUESTIONS)[number] }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotionPref();
  return (
    <details
      data-question={entry.id}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group border-b border-rule"
    >
      <summary className="-mx-3 flex min-h-16 cursor-pointer list-none items-center gap-4 rounded-xl px-3 py-4 transition-colors duration-(--dur-micro) hover:bg-hover active:bg-pressed [&::-webkit-details-marker]:hidden">
        <span className="flex-1 type-site-subhead text-ink">{entry.question}</span>
        <ChevronDown
          aria-hidden
          strokeWidth={ICON_STROKE}
          className="size-5 shrink-0 text-ink-3 transition-transform duration-(--dur-short) ease-(--ease-out) group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <motion.div
        key={open ? 'open' : 'closed'}
        initial={open && !reduce ? { opacity: 0, y: -6 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
        className="pb-6"
      >
        <p className="m-0 max-w-[60ch] type-site-body text-pretty text-ink-2">{entry.answer}</p>
      </motion.div>
    </details>
  );
}

export function PremiumQuestions() {
  return (
    <Section
      id={PREMIUM_PAGE.questions.id}
      heading={PREMIUM_PAGE.questions.heading}
      width="narrow"
      className="scroll-mt-24"
    >
      <Arrive className="border-t border-rule">
        {PREMIUM_QUESTIONS.map((entry) => (
          <Question key={entry.id} entry={entry} />
        ))}
      </Arrive>
    </Section>
  );
}
