// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: waitlist success · replaces the form once the address is on the list (or already was: the same words,
 *   so the form never says whether an address is listed)
 * mode: Persuade · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 (Motion › Arrival and Tick; Feedback)
 * states: arrived (one line rises 8 px and fades in, the tick draws in) · focused (takes focus from the form it
 *   replaced, so a keyboard user continues from here)
 * reduced motion: a 150 ms fade, no rise; the tick is whole */

import { motion, useReducedMotion } from 'motion/react';
import type { Ref } from 'react';
import { DUR, EASE_OUT, REDUCED_FADE, RISE } from '#lib/motion';
import { Tick } from './form-parts';
import { INSTAGRAM, WAITLIST_WORDS } from '#content/forms';

export function FollowLine({ lead }: { readonly lead?: string }) {
  return (
    <p className="m-0 type-body text-ink-2">
      {lead ? `${lead} ` : null}
      {WAITLIST_WORDS.follow}{' '}
      <a
        href={INSTAGRAM.url}
        rel="me noopener noreferrer"
        className="whitespace-nowrap text-ink underline decoration-rule-strong decoration-1 underline-offset-4 transition-colors duration-(--dur-micro) hover:decoration-ink"
      >
        {INSTAGRAM.handle}
      </a>{' '}
      {WAITLIST_WORDS.followTail}
    </p>
  );
}

export function WaitlistSuccess({ ref }: { readonly ref?: Ref<HTMLDivElement> }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      tabIndex={-1}
      className="flex flex-col gap-2 rounded-md"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: RISE }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: REDUCED_FADE } : { duration: DUR.short, ease: EASE_OUT }}
    >
      <p className="m-0 flex items-center gap-2.5 type-site-lead font-semibold text-ink">
        <Tick size={22} strokeWidth={2.5} className="text-success-strong" />
        {WAITLIST_WORDS.success}
      </p>
      <FollowLine />
    </motion.div>
  );
}
