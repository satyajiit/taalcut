// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: questions (FAQ teaser) · mode: Persuade (quiet, before the close) · system: WEB2 Remix Vernacular
 * states: a question: closed (default; no JavaScript: the browser's own <details>) · open (the answer rises in; at
 *   once under reduced motion; the chevron turns) · hover (surface) · focus (base ring on the summary) · active
 *   (pressed surface) · keyboard: Tab to a question, Enter or Space opens and closes it (the browser's own)
 * Three questions from the FAQ, word for word (#content/faq), as an accordion, and the way to all of them. */

import { ChevronDown, MessageCircleQuestion, ShieldCheck, SquarePlay, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { Arrive, Section } from '#components/ui/section';
import { FAQ } from '#content/faq';
import { FAQ_TEASER } from '#content/home';
import type { FaqEntry } from '#content/schema';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { EASE_OUT } from '#lib/motion';
import { MoreLink } from './kit';

const ICON: Readonly<Record<string, LucideIcon>> = { 'which-reels': SquarePlay, 'do-i-edit': ICONS.make, 'footage-leaves': ShieldCheck };

function Question({ entry }: { readonly entry: FaqEntry }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotionPref();
  const Icon = ICON[entry.id] ?? MessageCircleQuestion;
  return (
    <details
      data-question={entry.id}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group border-b border-rule"
    >
      <summary className="-mx-3 flex min-h-16 cursor-pointer list-none items-center gap-4 rounded-xl px-3 py-4 transition-colors duration-(--dur-micro) hover:bg-hover active:bg-pressed [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-grid size-10 shrink-0 place-items-center rounded-xl bg-raised text-ink-2 shadow-xs ring-1 ring-rule-subtle">
          <Icon strokeWidth={ICON_STROKE} className="size-5" />
        </span>
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
        className="pb-6 ps-14"
      >
        <p className="max-w-[60ch] type-site-body text-ink-2">{entry.answer}</p>
      </motion.div>
    </details>
  );
}

export function FaqTeaser() {
  const entries = FAQ_TEASER.ids.flatMap((id) => FAQ.filter((f) => f.id === id));
  return (
    <Section id="questions" heading={FAQ_TEASER.heading} width="narrow">
      <Arrive className="border-t border-rule">
        {entries.map((entry) => (
          <Question key={entry.id} entry={entry} />
        ))}
      </Arrive>
      <Arrive className="mt-8">
        <MoreLink href="/faq/">{FAQ_TEASER.all}</MoreLink>
      </Arrive>
    </Section>
  );
}
